import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import type Anthropic from '@anthropic-ai/sdk';
import { TUNING_PRESETS, barStatus, newSongDoc, type DocTrack, type SongDoc } from '../shared/editor/doc.ts';
import { typeFret, type Cursor } from '../shared/editor/commands.ts';
import { docToTex } from '../shared/editor/tex.ts';
import {
  MAX_RIFF_BARS,
  RIFF_SCHEMA,
  applyRiff,
  asciiTab,
  buildRiffRequest,
  riffRequestProblem,
  riffTimeSignatures,
  riffToBars,
  riffUserMessage,
  type AiRiff,
  type RiffRequest,
} from '../shared/editor/assistant.ts';
import { RIFF_MODEL, RiffAssistant, askClaude } from '../server/assistant.ts';
import type { FretlaneCloud } from '../server/cloud.ts';
import { HttpError } from '../server/library.ts';

const GUITAR: DocTrack = { name: 'Guitar', kind: 'guitar', sound: 'distortionguitar', tuning: TUNING_PRESETS.find((p) => p.id === 'guitar-drop-d')!.tuning };
const BASS: DocTrack = { name: 'Bass', kind: 'bass', sound: 'electricbassfinger', tuning: TUNING_PRESETS.find((p) => p.id === 'bass-standard')!.tuning };
const START: Cursor = { track: 0, bar: 0, beat: 0, string: 6 };

function song(tracks: DocTrack[] = [GUITAR], bars = 4): SongDoc {
  return newSongDoc({ title: 'Riffs', artist: 'Me', tempo: 140, ts: [4, 4], tracks, bars });
}

/** A song with notes on the low string in the given bars of track 0. */
function withNotes(doc: SongDoc, bars: number[]): SongDoc {
  for (const bar of bars) doc = typeFret(doc, { ...START, bar }, bar + 1, { duration: 4 }).doc;
  return doc;
}

/** Eight eighth notes on string 6 (one 4/4 bar). */
function eighths(frets: number[]): AiRiff['bars'][number] {
  return { beats: frets.map((fret) => ({ duration: 8, dotted: false, triplet: false, notes: [{ string: 6, fret, techniques: [] }] })) };
}

function parse(tex: string): alphaTab.model.Score {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  return importer.readScore();
}

describe('riff requests', () => {
  it('describes the instrument, tuning, tempo and the selected bars for improve', () => {
    const doc = withNotes(song(), [1, 2]);
    const req = buildRiffRequest(doc, 0, { mode: 'improve', range: { from: 2, to: 1 }, prompt: ' heavier ' });
    expect(req.mode).toBe('improve');
    expect(req.bars).toBe(2);
    expect(req.context).toContain('guitar, 6 strings');
    expect(req.context).toContain('string 1 = E4');
    expect(req.context).toContain('string 6 = D2');
    expect(req.context).toContain('Tempo: 140 BPM. Time signature: 4/4.');
    expect(req.context).toContain('The selected riff (bars 2–3)');
    expect(req.context).toContain('Bar 2 (4/4): s6f2 1/4');
    // The ASCII tab: highest string on top, the low D string at the bottom with the frets in it.
    const tabLines = req.context.split('\n').filter((l) => /^[A-Ga-g]b?#? *\|/.test(l));
    expect(tabLines).toHaveLength(6);
    expect(tabLines[0].startsWith('e ')).toBe(true);
    expect(tabLines[5]).toMatch(/^D +\|-2.*\|-3/);
    expect(riffRequestProblem(req)).toBeNull();
    expect(riffUserMessage(req)).toContain('Return exactly 2 bars.');
    expect(riffUserMessage(req)).toContain('heavier');
  });

  it('shows what comes before a new riff, or says nothing has been written yet', () => {
    const empty = buildRiffRequest(song(), 0, { mode: 'generate', at: 0, bars: 4, prompt: 'a doom riff' });
    expect(empty.context).toContain('Nothing has been written before the new riff yet.');
    expect(empty.bars).toBe(4);
    const doc = withNotes(song([GUITAR], 6), [0, 2, 3]);
    const req = buildRiffRequest(doc, 0, { mode: 'generate', at: 5, bars: 2, prompt: 'answer it' });
    expect(req.context).toContain('What comes just before the new riff');
    expect(req.context).toContain('Bar 3 (4/4)');
    expect(req.context).toContain('Bar 4 (4/4)');
    expect(req.context).not.toContain('Bar 1 (4/4)');
  });

  it('describes a bass by its own strings', () => {
    const req = buildRiffRequest(song([GUITAR, BASS]), 1, { mode: 'generate', at: 0, bars: 1, prompt: 'groove' });
    expect(req.context).toContain('bass, 4 strings');
    expect(req.context).toContain('string 4 = E1');
  });

  it('refuses requests that are malformed or too big', () => {
    const ok: RiffRequest = { mode: 'generate', prompt: 'riff', bars: 2, context: 'Song' };
    expect(riffRequestProblem(ok)).toBeNull();
    expect(riffRequestProblem(null)).toMatch(/Missing/);
    expect(riffRequestProblem({ ...ok, mode: 'solo' })).toMatch(/mode/);
    expect(riffRequestProblem({ ...ok, prompt: '  ' })).toMatch(/Describe/);
    expect(riffRequestProblem({ ...ok, mode: 'improve', prompt: '' })).toBeNull();
    expect(riffRequestProblem({ ...ok, bars: MAX_RIFF_BARS + 1 })).toMatch(/bars/);
    expect(riffRequestProblem({ ...ok, bars: 1.5 })).toMatch(/bars/);
    expect(riffRequestProblem({ ...ok, prompt: 'x'.repeat(601) })).toMatch(/600/);
    expect(riffRequestProblem({ ...ok, context: 'x'.repeat(12_001) })).toMatch(/fewer bars/);
  });

  it('has a schema structured outputs accepts: every object closed and fully required', () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown; items?: unknown };
      if (n.type === 'object') {
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required ?? [])].sort()).toEqual(Object.keys(n.properties ?? {}).sort());
      }
      Object.values(n.properties ?? {}).forEach(walk);
      walk(n.items);
    };
    walk(RIFF_SCHEMA);
  });
});

describe('riffToBars', () => {
  const ts44 = (): [number, number] => [4, 4];

  it('keeps a correct riff as it is', () => {
    const r = riffToBars({ explanation: ' A chug. ', bars: [eighths([0, 0, 3, 0, 0, 5, 3, 0])] }, 6, ts44);
    expect(r.explanation).toBe('A chug.');
    expect(r.fixes).toEqual([]);
    expect(r.bars[0]).toHaveLength(8);
    expect(r.bars[0][2]).toEqual({ duration: 8, notes: [{ string: 6, fret: 3 }] });
  });

  it('drops notes the instrument cannot play and doubled strings, and says so', () => {
    const raw = {
      explanation: '',
      bars: [
        {
          beats: [
            { duration: 2, dotted: false, triplet: false, notes: [{ string: 7, fret: 0, techniques: [] }, { string: 6, fret: 25, techniques: [] }, { string: 5, fret: 2, techniques: [] }, { string: 5, fret: 4, techniques: [] }] },
            { duration: 2, dotted: false, triplet: false, notes: [{ string: 1, fret: 12, techniques: ['vibrato', 'bogus'] }] },
          ],
        },
      ],
    };
    const r = riffToBars(raw, 6, ts44);
    expect(r.bars[0][0].notes).toEqual([{ string: 5, fret: 2 }]);
    expect(r.bars[0][1].notes).toEqual([{ string: 1, fret: 12, vibrato: true }]);
    expect(r.fixes).toEqual(['3 notes that didn\'t fit the instrument were left out.']);
  });

  it('fills a short bar with rests and cuts a long one', () => {
    const short = { beats: eighths([0, 3, 5]).beats };
    const long = { beats: [...eighths([0, 0, 0, 0, 0, 0, 0, 0]).beats, ...eighths([7, 7]).beats] };
    const r = riffToBars({ explanation: '', bars: [short, long] }, 6, ts44);
    const doc = { ...song(), bars: r.bars.map((v) => ({ ts: [4, 4] as [number, number], tracks: [v] })) };
    expect(barStatus(doc, 0, 0).diff).toBe(0);
    expect(barStatus(doc, 0, 1).diff).toBe(0);
    expect(r.bars[0].slice(3).every((b) => !b.notes.length)).toBe(true);
    expect(r.bars[1].every((b) => b.notes[0]?.fret === 0)).toBe(true);
    expect(r.fixes).toContain('2 bars didn\'t add up and were trimmed or filled with rests.');
  });

  it('fits each bar to the time signature it will go into', () => {
    const r = riffToBars({ explanation: '', bars: [eighths([0, 0, 0, 0, 0, 0, 0, 0])] }, 6, () => [3, 4]);
    expect(r.bars[0]).toHaveLength(6);
  });

  it('gives a tie the fret it holds, across bars, and drops a tie with nothing to hold', () => {
    const tie = (fret: number) => ({ duration: 2 as const, dotted: false, triplet: false, notes: [{ string: 6, fret, techniques: ['tie' as const] }] });
    const r = riffToBars(
      {
        explanation: '',
        bars: [
          { beats: [tie(9), { duration: 2, dotted: false, triplet: false, notes: [{ string: 6, fret: 5, techniques: ['dead'] }] }] },
          { beats: [tie(0), { duration: 2, dotted: false, triplet: false, notes: [{ string: 6, fret: 3, techniques: ['palmMute', 'hammer'] }] }] },
        ],
      },
      6,
      ts44,
    );
    expect(r.bars[0][0].notes[0]).toEqual({ string: 6, fret: 9 });
    expect(r.bars[0][1].notes[0]).toEqual({ string: 6, fret: 5, dead: true });
    expect(r.bars[1][0].notes[0]).toEqual({ string: 6, fret: 5, tie: true });
    expect(r.bars[1][1].notes[0]).toEqual({ string: 6, fret: 3, hammer: true, palmMute: true });
  });

  it('keeps at most the bars asked for and refuses answers without notes', () => {
    const many = Array.from({ length: 10 }, () => eighths([0, 0, 0, 0, 0, 0, 0, 0]));
    const r = riffToBars({ explanation: '', bars: many }, 6, ts44, 8);
    expect(r.bars).toHaveLength(8);
    expect(r.fixes[0]).toBe('Only the first 8 bars were kept.');
    expect(() => riffToBars({ text: 'hi' }, 6, ts44)).toThrow(/not a riff/);
    expect(() => riffToBars({ explanation: '', bars: [{ beats: [{ duration: 1, dotted: false, triplet: false, notes: [] }] }] }, 6, ts44)).toThrow(/without any notes/);
  });
});

describe('applyRiff', () => {
  const riff = (n: number) => riffToBars({ explanation: '', bars: Array.from({ length: n }, (_, i) => eighths([i, i, i, i, i, i, i, i])) }, 6, () => [4, 4]).bars;

  it('writes a new riff into empty bars from the cursor bar', () => {
    const doc = song();
    const e = applyRiff(doc, START, 0, { at: 1 }, riff(2));
    expect(e.doc.bars).toHaveLength(4);
    expect(e.range).toEqual({ from: 1, to: 2 });
    expect(e.changedBar).toBe(1);
    expect(e.cursor).toMatchObject({ bar: 1, beat: 0 });
    expect(e.doc.bars[1].tracks[0][0].notes[0].fret).toBe(0);
    expect(e.doc.bars[2].tracks[0][0].notes[0].fret).toBe(1);
    expect(doc.bars[1].tracks[0][0].notes).toEqual([]); // the old document is untouched (undo)
  });

  it('never writes over notes: a new riff is inserted before the next filled bar', () => {
    const doc = withNotes(song([GUITAR, BASS], 4), [2]);
    const e = applyRiff(doc, START, 0, { at: 1 }, riff(3));
    expect(e.doc.bars).toHaveLength(6);
    expect(e.range).toEqual({ from: 1, to: 3 });
    expect(e.doc.bars[4].tracks[0][0].notes[0]).toEqual({ string: 6, fret: 3 }); // the old bar 3, moved along
    expect(e.doc.bars[2].tracks[1].every((b) => !b.notes.length)).toBe(true); // a new bar: rests on the bass
    expect(riffTimeSignatures(doc, 0, { at: 1 }, 3)).toEqual([[4, 4], [4, 4], [4, 4]]);
  });

  it('adds bars after the end of the song', () => {
    const e = applyRiff(song([GUITAR], 2), START, 0, { at: 2 }, riff(2));
    expect(e.doc.bars).toHaveLength(4);
    expect(e.range).toEqual({ from: 2, to: 3 });
  });

  it('improve replaces the selected bars on one track and keeps the other tracks', () => {
    let doc = withNotes(song([GUITAR, BASS], 4), [1, 2]);
    doc = typeFret(doc, { track: 1, bar: 1, beat: 0, string: 4 }, 5, { duration: 4 }).doc;
    const e = applyRiff(doc, START, 0, { replace: { from: 1, to: 2 } }, riff(2));
    expect(e.doc.bars).toHaveLength(4);
    expect(e.range).toEqual({ from: 1, to: 2 });
    expect(e.doc.bars[1].tracks[0]).toHaveLength(8);
    expect(e.doc.bars[1].tracks[1][0].notes[0]).toEqual({ string: 4, fret: 5 });
  });

  it('improve with fewer bars than selected leaves rests; with more, inserts after the selection', () => {
    const doc = withNotes(song([GUITAR], 4), [0, 1, 2, 3]);
    const fewer = applyRiff(doc, START, 0, { replace: { from: 1, to: 2 } }, riff(1));
    expect(fewer.doc.bars[2].tracks[0].every((b) => !b.notes.length)).toBe(true);
    expect(fewer.range).toEqual({ from: 1, to: 2 });
    const more = applyRiff(doc, START, 0, { replace: { from: 1, to: 1 } }, riff(2));
    expect(more.doc.bars).toHaveLength(5);
    expect(more.doc.bars[3].tracks[0][0].notes[0]).toEqual({ string: 6, fret: 3 });
  });

  it('produces a song alphaTab can read, with every bar full', () => {
    const doc = withNotes(song([GUITAR, BASS], 3), [0]);
    const r = riffToBars(
      {
        explanation: '',
        bars: [
          { beats: [{ duration: 4, dotted: true, triplet: false, notes: [{ string: 6, fret: 0, techniques: ['palmMute'] }, { string: 5, fret: 0, techniques: ['palmMute'] }] }, ...Array.from({ length: 3 }, () => ({ duration: 8 as const, dotted: false, triplet: true, notes: [{ string: 4, fret: 2, techniques: ['slide' as const] }] })), { duration: 2, dotted: false, triplet: false, notes: [{ string: 3, fret: 4, techniques: ['bend', 'letRing'] }] }] },
        ],
      },
      6,
      () => [4, 4],
    );
    const e = applyRiff(doc, START, 0, { at: 1 }, r.bars);
    const score = parse(docToTex(e.doc));
    expect(score.masterBars).toHaveLength(3);
    for (let b = 0; b < 3; b++) for (let t = 0; t < 2; t++) expect(barStatus(e.doc, t, b).diff).toBe(0);
    const beats = score.tracks[0].staves[0].bars[1].voices[0].beats;
    expect(beats[0].notes.map((n) => n.isPalmMute)).toEqual([true, true]);
  });

  it('draws ASCII tab with wider columns for two-digit frets', () => {
    const doc = applyRiff(song(), START, 0, { at: 0 }, riffToBars({ explanation: '', bars: [{ beats: [{ duration: 2, dotted: false, triplet: false, notes: [{ string: 6, fret: 12, techniques: [] }] }, { duration: 2, dotted: false, triplet: false, notes: [{ string: 6, fret: 3, techniques: ['dead'] }] }] }] }, 6, () => [4, 4]).bars).doc;
    const tab = asciiTab([doc.bars[0]], 0, 6, ['e', 'B', 'G', 'D', 'A', 'D']).split('\n');
    expect(tab[5]).toBe('D |-12-x-|');
    expect(tab[0]).toBe('e |------|');
  });
});

describe('server: RiffAssistant', () => {
  const req: RiffRequest = { mode: 'generate', prompt: 'a riff', bars: 1, context: 'Song: "x"' };
  const answer: AiRiff = { explanation: 'ok', bars: [eighths([0, 0, 0, 0, 0, 0, 0, 0])] };

  function fakeClient(reply: Partial<Anthropic.Beta.BetaMessage> | Error) {
    const calls: unknown[] = [];
    const client = {
      beta: {
        messages: {
          create: async (params: unknown) => {
            calls.push(params);
            if (reply instanceof Error) throw reply;
            return reply;
          },
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  }

  it('calls Claude with the prompt, the schema and the fallback, and parses the JSON', async () => {
    const { client, calls } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) } as Anthropic.Beta.BetaTextBlock] });
    expect(await askClaude(client, req)).toEqual(answer);
    const params = calls[0] as Record<string, any>;
    expect(params.model).toBe(RIFF_MODEL);
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.output_config.format).toEqual({ type: 'json_schema', schema: RIFF_SCHEMA });
    expect(params.messages[0].content).toContain('Write a new riff of exactly 1 bar.');
    expect(params.system).toContain('String 1 is the highest-pitched string.');
  });

  it('turns refusals, cut-off answers and broken JSON into readable errors', async () => {
    await expect(askClaude(fakeClient({ stop_reason: 'refusal', content: [] }).client, req)).rejects.toMatchObject({ status: 422 });
    await expect(askClaude(fakeClient({ stop_reason: 'max_tokens', content: [] }).client, req)).rejects.toThrow(/fewer bars/);
    await expect(askClaude(fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"bars": [' } as Anthropic.Beta.BetaTextBlock] }).client, req)).rejects.toThrow(/not a riff/);
    await expect(askClaude(fakeClient(new TypeError('fetch failed')).client, req)).rejects.toThrow(/Could not reach/);
  });

  it('uses Fretlane Cloud without an own key, and asks to sign in when signed out', async () => {
    let sent: unknown = null;
    const cloud = {
      status: () => ({ connected: sent !== 'signed-out', email: 'a@b.c', siteUrl: 'https://x' }),
      riffAssistant: async (r: RiffRequest) => {
        sent = r;
        return answer;
      },
    } as unknown as FretlaneCloud;
    const assistant = new RiffAssistant(cloud, undefined);
    expect(assistant.via).toBe('cloud');
    expect(await assistant.riff(req)).toEqual({ riff: answer, via: 'cloud' });
    expect(sent).toEqual(req);
    await expect(assistant.riff({ ...req, bars: 99 })).rejects.toBeInstanceOf(HttpError);
    sent = 'signed-out';
    await expect(assistant.riff(req)).rejects.toMatchObject({ status: 402 });
  });

  it('uses the own key when one is set', async () => {
    const { client } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) } as Anthropic.Beta.BetaTextBlock] });
    const assistant = new RiffAssistant({ status: () => ({ connected: false }) } as unknown as FretlaneCloud, undefined, client);
    expect(await assistant.riff(req)).toEqual({ riff: answer, via: 'own-key' });
  });
});
