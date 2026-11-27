/**
 * Fretlane's MCP server: lets the user's own Claude (Claude Desktop, Claude Code, or any MCP client)
 * read the library and write songs into it, without the Fretlane Cloud assistant plan. Claude does
 * the composing in the user's own subscription; these tools only read and write tab.
 *
 * The tools talk to the running Fretlane app over its local HTTP API, so the app stays the only
 * writer of the library and its window shows new songs straight away. The notes go through the same
 * fitting and checks as the riff assistant (shared/editor/songwriter.ts).
 *
 * What stays Premium: changing a song in place (write_bars, and saving new songs as editable
 * "written" songs) uses the tab editor's save, which needs Fretlane Premium. Without it, create_song
 * still adds the song as a normal tab that plays in the player, like importing one.
 */
import * as alphaTab from '@coderline/alphatab';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { APP_ID, APP_NAME, envVar } from '../shared/brand.ts';
import type { Song } from '../shared/types.ts';
import { asciiTabToAlphaTex } from '../shared/asciiTab.ts';
import { scoreToDoc } from '../shared/editor/fromScore.ts';
import { docToTex } from '../shared/editor/tex.ts';
import { asciiTab, songText, MAX_RIFF_PARTS, RIFF_DRUMS, RIFF_INSTRUMENTS, RIFF_TECHNIQUES } from '../shared/editor/assistant.ts';
import { pitchName, type SongDoc } from '../shared/editor/doc.ts';
import { MAX_SONG_BARS, MAX_WRITE_BARS, SONGWRITER_GUIDE, buildSong, writeBars, type NewSongSpec, type ToolPart } from '../shared/editor/songwriter.ts';

// ---------- talking to the app ----------

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Ports the app uses: `npm start` and the desktop app start at 5173 (and try the next 19), `npm run dev` serves the API on 5174. */
const PORTS = [5173, 5174, ...Array.from({ length: 18 }, (_, i) => 5175 + i)];

export class FretlaneApi {
  private base: string | null;

  /** `base` like "http://localhost:5173"; omitted: FRETLANE_URL, else the first local port with Fretlane on it. */
  constructor(base: string | undefined = envVar('URL')) {
    this.base = base ? base.replace(/\/+$/, '') : null;
  }

  /** The app's address, found on first use. */
  async url(): Promise<string> {
    if (this.base) return this.base;
    for (const port of PORTS) {
      const base = `http://localhost:${port}`;
      try {
        const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(800) });
        const body = (await res.json()) as { app?: string };
        if (body.app === APP_ID) return (this.base = base);
      } catch {
        /* nothing there, or not Fretlane */
      }
    }
    throw new ApiError(503, `${APP_NAME} isn't running. Open the ${APP_NAME} app (or run \`npm start\` in its folder) and try again.`);
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const base = await this.url();
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, init);
    } catch {
      this.base = envVar('URL') ?? null; // the app may have restarted on another port
      throw new ApiError(503, `Could not reach ${APP_NAME} at ${base}. Is it still open?`);
    }
    if (!res.ok) {
      let message = `${APP_NAME} answered ${res.status}`;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, message);
    }
    return res;
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await this.request(path, init)).json()) as T;
  }

  songs(): Promise<Song[]> {
    return this.json('/api/songs');
  }

  song(id: string): Promise<Song> {
    return this.json(`/api/songs/${encodeURIComponent(id)}`);
  }

  async tab(id: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.request(`/api/songs/${encodeURIComponent(id)}/tab`)).arrayBuffer());
  }

  addSong(input: { title: string; artist: string; tabText: string; written?: boolean; tags?: string[] }): Promise<Song> {
    return this.json('/api/songs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  }

  setTab(id: string, tex: string): Promise<Song> {
    return this.json(`/api/songs/${encodeURIComponent(id)}/tab`, { method: 'PUT', headers: { 'content-type': 'text/plain; charset=utf-8' }, body: tex });
  }
}

/** Reads any stored tab (Guitar Pro, MusicXML, alphaTex) into the editor's document. */
export function tabToDoc(song: Song, bytes: Uint8Array): { doc: SongDoc; dropped: string[] } {
  const settings = new alphaTab.Settings();
  settings.core.logLevel = alphaTab.LogLevel.None;
  let score: alphaTab.model.Score;
  if (song.tabFormat === 'alphatex' || song.tabFormat === 'ascii') {
    let text = new TextDecoder().decode(bytes);
    if (song.tabFormat === 'ascii') text = asciiTabToAlphaTex(text, { title: song.title, artist: song.artist });
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(text, settings);
    score = importer.readScore();
  } else {
    score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
  }
  return scoreToDoc(score);
}

// ---------- the tools ----------

const noteSchema = z.object({
  string: z.number().int().optional().describe('Guitar and bass: 1 = the highest-pitched string. Leave out for drums.'),
  fret: z.number().int().optional().describe('Guitar and bass: 0 = open string. Leave out for drums.'),
  drum: z.enum(RIFF_DRUMS as [string, ...string[]]).optional().describe('Drums only: which drum.'),
  techniques: z.array(z.enum(RIFF_TECHNIQUES)).optional(),
});
const beatSchema = z.object({
  duration: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16), z.literal(32)]).describe('1 = whole, 4 = quarter, 8 = eighth, 16 = sixteenth.'),
  dotted: z.boolean().optional(),
  triplet: z.boolean().optional().describe('Three of these take the time of two.'),
  notes: z.array(noteSchema).optional().describe('Notes or drum hits struck together. Empty or left out = a rest.'),
});
const barsSchema = z.array(z.object({ beats: z.array(beatSchema) })).describe('Bar by bar. Every bar must add up to the time signature.');
const instrument = z.enum(RIFF_INSTRUMENTS);

function text(t: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) };
}

function problemsText(problems: string[]): string {
  return ['The checks found problems, so nothing was saved yet:', ...problems.map((p) => `- ${p}`), '', 'Fix them and call again with the whole answer, or pass force: true to save it as it is (bars that don\'t add up are trimmed or filled with rests).'].join('\n');
}

function songLine(s: Song): string {
  const bits = [s.tabFormat, s.written ? 'written in Fretlane (editable)' : '', s.archivedAt ? 'archived' : '', s.favorite ? '★' : ''].filter(Boolean);
  return `- ${s.id}: "${s.title}"${s.artist ? ` by ${s.artist}` : ''} (${bits.join(', ')})`;
}

/** Wraps a tool so errors come back as a tool error Claude can read, not a protocol error. */
function safe<A>(fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return text((err as Error).message, true);
    }
  };
}

export function createFretlaneMcp(api: FretlaneApi = new FretlaneApi()): McpServer {
  const server = new McpServer(
    { name: APP_ID, version: '1.0.0' },
    {
      instructions: `${APP_NAME} is the user's tab player and editor. Use these tools to read songs from their library and to write new songs or parts as guitar, bass and drum tab. Read a song with get_song before writing bars for it.\n\n${SONGWRITER_GUIDE}`,
    },
  );

  server.registerTool(
    'list_songs',
    {
      title: 'List songs',
      description: `Lists the songs in the user's ${APP_NAME} library: id, title, artist, tab format, and whether it was written in ${APP_NAME} (only those can be changed in place with write_bars).`,
      inputSchema: { query: z.string().optional().describe('Only songs whose title or artist contains this.') },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query }) => {
      const q = query?.trim().toLowerCase();
      const songs = (await api.songs()).filter((s) => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q));
      return text(songs.length ? songs.map(songLine).join('\n') : q ? `No songs match "${query}".` : 'The library is empty.');
    }),
  );

  server.registerTool(
    'get_song',
    {
      title: 'Read a song',
      description:
        'Reads a song from the library: its tempo, time signature, sections, estimated key and chords, its tracks with their tunings, and every bar of every track as beats (s<string>f<fret>, drum names, durations). With fromBar/toBar it also shows those bars as ASCII tab.',
      inputSchema: {
        songId: z.string().describe('The id from list_songs.'),
        fromBar: z.number().int().min(1).optional(),
        toBar: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ songId, fromBar, toBar }) => {
      const song = await api.song(songId);
      const { doc, dropped } = tabToDoc(song, await api.tab(songId));
      const out = [`Song id: ${song.id}${song.written ? ' (written in Fretlane: write_bars can change it)' : ' (imported: write_bars cannot change it; create_song can save your own version)'}`, songText(doc, (fromBar ?? 1) - 1)];
      if (dropped.length) out.push('', `Not shown (the editor can't represent it): ${dropped.join(', ')}.`);
      if (fromBar) {
        const from = Math.min(fromBar, doc.bars.length) - 1;
        const to = Math.min(Math.max(toBar ?? fromBar, fromBar), doc.bars.length, from + 32) - 1;
        doc.tracks.forEach((t, i) => {
          if (t.kind === 'drums') return;
          const labels = t.tuning.map((p, s) => {
            const name = pitchName(p).replace(/-?\d+$/, '');
            return s === 0 && t.kind === 'guitar' ? name.toLowerCase() : name;
          });
          out.push('', `Track ${i + 1} "${t.name}", bars ${from + 1}–${to + 1}:`, asciiTab(doc.bars.slice(from, to + 1), i, t.tuning.length, labels));
        });
      }
      return text(out.join('\n'));
    }),
  );

  server.registerTool(
    'create_song',
    {
      title: 'Write a new song',
      description: `Writes a new song into the ${APP_NAME} library: tracks (guitar, bass, drums) and, per track, its bars of beats. Up to ${MAX_SONG_BARS} bars; continue a longer song with write_bars. The song is checked like ${APP_NAME}'s own assistant checks riffs (bar lengths, strings and frets, stretches, drum hits); when problems are found nothing is saved and they are listed so you can fix them. With Fretlane Premium the song is editable in the tab editor; without it, it is saved as a normal tab that plays in the player.\n\n${SONGWRITER_GUIDE}`,
      inputSchema: {
        title: z.string().min(1).max(120),
        artist: z.string().max(120).optional().describe('Leave out for the user\'s own song.'),
        tempo: z.number().int().min(20).max(400).optional().describe('BPM, default 120.'),
        timeSignature: z.tuple([z.number().int(), z.number().int()]).optional().describe('e.g. [4, 4] (default) or [6, 8].'),
        tracks: z
          .array(
            z.object({
              name: z.string().optional(),
              instrument,
              tuning: z.string().optional().describe('Notes lowest string first, e.g. "D A D G B E" or "B E A D G B E", or a preset id such as "guitar-drop-d", "bass-5-standard". Default: standard tuning.'),
              sound: z.string().optional().describe('Guitar: electricguitarclean, overdrivenguitar, distortionguitar, acousticguitarsteel, acousticguitarnylon, electricguitarmuted. Bass: electricbassfinger, electricbasspick, fretlessbass, acousticbass.'),
            }),
          )
          .min(1)
          .max(8),
        sections: z.array(z.object({ bar: z.number().int().min(1), name: z.string() })).optional().describe('Section names above bars, e.g. Intro at bar 1, Verse at bar 5.'),
        parts: z.array(z.object({ track: z.number().int().min(1).describe('1 = the first track above.'), bars: barsSchema })).describe('One part per track, each with all of its bars.'),
        tags: z.array(z.string()).optional(),
        force: z.boolean().optional().describe('Save even when the checks find problems.'),
      },
    },
    safe(async (args) => {
      const { doc, problems, fixes } = buildSong(args as NewSongSpec);
      if (problems.length && !args.force) return text(problemsText(problems), true);
      const tex = docToTex(doc);
      const input = { title: doc.title, artist: doc.artist, tabText: tex, tags: args.tags };
      let song: Song;
      let note: string;
      try {
        song = await api.addSong({ ...input, written: true });
        note = 'It is editable in the tab editor, and write_bars can change it.';
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 402)) throw err;
        song = await api.addSong(input);
        note = 'It plays in the player. Editing it in the tab editor (and changing it with write_bars) needs Fretlane Premium; to change it, write a new version with create_song.';
      }
      const base = await api.url();
      return text(
        [
          `Saved "${song.title}" (${doc.bars.length} bars, ${doc.tracks.length} track${doc.tracks.length === 1 ? '' : 's'}) as song ${song.id}. ${note}`,
          `Open it: ${base}/#/song/${encodeURIComponent(song.id)}`,
          ...(fixes.length ? ['', 'Repaired on the way:', ...fixes.map((f) => `- ${f}`)] : []),
          ...(problems.length ? ['', 'Saved despite these problems:', ...problems.map((p) => `- ${p}`)] : []),
        ].join('\n'),
      );
    }),
  );

  server.registerTool(
    'write_bars',
    {
      title: 'Write bars into a song',
      description: `Changes a song written in ${APP_NAME} (needs Fretlane Premium): improve replaces bars fromBar–toBar on the tracks you write; generate adds new bars from atBar on (default: after the last bar), filling bars that are still empty on those tracks and inserting before any bar that has notes. Up to ${MAX_RIFF_PARTS} parts and ${MAX_WRITE_BARS} bars per call. A part with track 0 adds a new track. Read the song with get_song first. Checked like create_song.\n\n${SONGWRITER_GUIDE}`,
      inputSchema: {
        songId: z.string(),
        mode: z.enum(['improve', 'generate']),
        fromBar: z.number().int().min(1).optional().describe('improve: first bar to replace.'),
        toBar: z.number().int().min(1).optional().describe('improve: last bar to replace.'),
        atBar: z.number().int().min(1).optional().describe('generate: where the new bars start.'),
        parts: z
          .array(
            z.object({
              track: z.number().int().min(0).describe('An existing track number (1 = first), or 0 for a new track.'),
              instrument: instrument.optional().describe('Needed for a new track.'),
              name: z.string().optional().describe('A new track\'s name, e.g. "Bass".'),
              bars: barsSchema,
            }),
          )
          .min(1)
          .max(MAX_RIFF_PARTS),
        force: z.boolean().optional().describe('Save even when the checks find problems.'),
      },
    },
    safe(async (args) => {
      const song = await api.song(args.songId);
      if (!song.written) return text(`"${song.title}" was imported, not written in ${APP_NAME}, so it can't be changed in place. Read it with get_song and save your version with create_song.`, true);
      if (args.mode === 'improve' && (!args.fromBar || !args.toBar)) return text('improve needs fromBar and toBar.', true);
      const { doc } = tabToDoc(song, await api.tab(song.id));
      const where = args.mode === 'improve' ? { mode: 'improve' as const, fromBar: args.fromBar!, toBar: args.toBar! } : { mode: 'generate' as const, atBar: args.atBar };
      const result = writeBars(doc, where, args.parts as ToolPart[]);
      if (result.problems.length && !args.force) return text(problemsText(result.problems), true);
      try {
        await api.setTab(song.id, docToTex(result.doc));
      } catch (err) {
        if (err instanceof ApiError && err.status === 402) return text(`${err.message} Without Premium, save your version as a new song with create_song.`, true);
        throw err;
      }
      return text(
        [
          `Wrote ${result.wrote} in bars ${result.fromBar}–${result.toBar} of "${song.title}" (now ${result.doc.bars.length} bars).`,
          `Open it: ${await api.url()}/#/write/${encodeURIComponent(song.id)}`,
          ...(result.fixes.length ? ['', 'Repaired on the way:', ...result.fixes.map((f) => `- ${f}`)] : []),
          ...(result.problems.length ? ['', 'Saved despite these problems:', ...result.problems.map((p) => `- ${p}`)] : []),
        ].join('\n'),
      );
    }),
  );

  return server;
}
