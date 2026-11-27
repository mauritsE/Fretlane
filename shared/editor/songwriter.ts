/**
 * Songwriting with the user's own Claude, through the MCP server (server/mcp.ts): Claude (in Claude
 * Desktop, Claude Code or any MCP client) writes a whole song, or bars of an existing one, in the
 * same note format as the riff assistant (AiBeat / AiNote in assistant.ts). This file turns that into
 * a SongDoc, reusing the assistant's fitting (`riffFromAnswer`, `applyRiff`) and checks
 * (`riffProblems`), so a song written this way is held to the same rules as one from the editor.
 *
 * Pure, so vitest covers it. The MCP tool schemas live in server/mcp.ts.
 */
import { DEFAULT_SOUND, DRUM_TUNING, SOUNDS, TUNING_PRESETS, clampTempo, newSongDoc, parseTuning, type DocTrack, type SongDoc } from './doc.ts';
import {
  MAX_RIFF_PARTS,
  MAX_SONG_TRACKS,
  RIFF_INSTRUMENTS,
  applyRiff,
  checkContext,
  describeWritten,
  riffFromAnswer,
  type AiBeat,
  type AiNote,
  type AiPart,
  type RiffTarget,
} from './assistant.ts';
import { riffProblems, type RiffCheckContext } from './riffCheck.ts';
import type { Cursor } from './commands.ts';

/** Instruments the songwriter writes (the same as the riff assistant). */
export type SongInstrument = (typeof RIFF_INSTRUMENTS)[number];

/** Most bars one call may write. A song longer than this is written in more calls (write_bars). */
export const MAX_SONG_BARS = 256;
/** Most bars write_bars may add or replace at once. */
export const MAX_WRITE_BARS = 64;

/** A note as an MCP client sends it: the riff assistant's AiNote, with the "not used" fields optional. */
export interface ToolNote {
  string?: number;
  fret?: number;
  drum?: string;
  techniques?: string[];
}
export interface ToolBeat {
  duration: number;
  dotted?: boolean;
  triplet?: boolean;
  notes?: ToolNote[];
}
export interface ToolPart {
  /** 1-based track number. In write_bars, 0 adds a new track. */
  track: number;
  /** write_bars: the instrument (needed for a new track). */
  instrument?: SongInstrument;
  /** write_bars: the new track's name. */
  name?: string;
  bars: { beats: ToolBeat[] }[];
}

export interface ToolTrack {
  name?: string;
  instrument: SongInstrument;
  /**
   * A tuning preset id (e.g. "guitar-drop-d") or the notes lowest string first ("D A D G B E").
   * Omitted: standard tuning. Ignored for drums.
   */
  tuning?: string;
  /** A sound from SOUNDS (doc.ts), e.g. "distortionguitar". Anything else: the default sound. */
  sound?: string;
}

export interface NewSongSpec {
  title: string;
  artist?: string;
  tempo?: number;
  /** e.g. [4, 4] or [6, 8]. */
  timeSignature?: [number, number];
  tracks: ToolTrack[];
  /** Section names shown above bars, e.g. { bar: 1, name: "Intro" }. */
  sections?: { bar: number; name: string }[];
  parts: ToolPart[];
}

export interface SongwriterResult {
  doc: SongDoc;
  /** What a guitarist would hear as wrong or couldn't play (riffCheck.ts). Nothing is fixed for these. */
  problems: string[];
  /** What was repaired to make it fit (notes left out, bars trimmed or padded). */
  fixes: string[];
}

/** Turns a ToolTrack into a DocTrack. Throws with a message Claude can act on. */
export function trackFromSpec(t: ToolTrack, index: number): DocTrack {
  if (!RIFF_INSTRUMENTS.includes(t.instrument)) throw new Error(`Track ${index + 1}: instrument must be ${RIFF_INSTRUMENTS.join(', ')}.`);
  const kind = t.instrument;
  const fallbackName = kind === 'drums' ? 'Drums' : kind === 'bass' ? 'Bass' : 'Guitar';
  const name = (t.name ?? '').trim().slice(0, 40) || fallbackName;
  const sound = SOUNDS[kind].some((x) => x.id === t.sound) ? t.sound! : DEFAULT_SOUND[kind];
  if (kind === 'drums') return { name, kind, sound: DEFAULT_SOUND.drums, tuning: [...DRUM_TUNING] };
  let tuning: number[] | null = TUNING_PRESETS.find((p) => p.kind === kind)!.tuning;
  if (t.tuning?.trim()) {
    const preset = TUNING_PRESETS.find((p) => p.kind === kind && p.id === t.tuning!.trim());
    tuning = preset ? preset.tuning : parseTuning(t.tuning, kind);
    if (!tuning) {
      const ids = TUNING_PRESETS.filter((p) => p.kind === kind).map((p) => p.id);
      throw new Error(`Track ${index + 1}: unknown tuning "${t.tuning}". Use notes lowest string first ("D A D G B E") or a preset: ${ids.join(', ')}.`);
    }
  }
  return { name, kind, sound, tuning: [...tuning] };
}

function aiNote(n: ToolNote, drums: boolean): AiNote {
  return {
    string: drums ? 0 : Number(n.string ?? 0),
    fret: drums ? 0 : Number(n.fret ?? 0),
    drum: drums ? String(n.drum ?? 'none') : 'none',
    techniques: Array.isArray(n.techniques) ? (n.techniques as AiNote['techniques']) : [],
  };
}

/** The riff assistant's part format, which riffFromAnswer and riffProblems read. */
function aiPart(p: ToolPart, kind: SongInstrument, name: string, track: number): AiPart {
  const drums = kind === 'drums';
  return {
    track,
    instrument: kind,
    name,
    bars: (p.bars ?? []).map((bar) => ({
      beats: (bar?.beats ?? []).map(
        (b): AiBeat => ({
          duration: b.duration as AiBeat['duration'],
          dotted: !!b.dotted,
          triplet: !!b.triplet,
          notes: (b.notes ?? []).map((n) => aiNote(n, drums)),
        }),
      ),
    })),
  };
}

function hasNotes(p: AiPart): boolean {
  return p.bars.some((b) => b.beats.some((x) => x.notes.length));
}

/** riffProblems reads at most MAX_RIFF_PARTS parts per answer: check them in groups. */
function problemsFor(parts: AiPart[], bars: number, ctx: RiffCheckContext): string[] {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += MAX_RIFF_PARTS) out.push(...riffProblems({ parts: parts.slice(i, i + MAX_RIFF_PARTS) }, bars, ctx));
  return out;
}

/** Writes parts into existing tracks of `doc` over `target`, MAX_RIFF_PARTS at a time. */
function writeParts(doc: SongDoc, parts: AiPart[], target: RiffTarget, maxBars: number): { doc: SongDoc; fixes: string[] } {
  const fixes: string[] = [];
  const cursor: Cursor = { track: 0, bar: 0, beat: 0, string: 1 };
  for (let i = 0; i < parts.length; i += MAX_RIFF_PARTS) {
    const group = parts.slice(i, i + MAX_RIFF_PARTS).filter(hasNotes);
    if (!group.length) continue;
    const riff = riffFromAnswer({ explanation: '', parts: group }, doc, target, maxBars);
    fixes.push(...riff.fixes);
    doc = applyRiff(doc, cursor, target, riff).doc;
  }
  return { doc, fixes };
}

/** Builds a new song from a whole-song spec. Throws when the spec can't make a song at all. */
export function buildSong(spec: NewSongSpec): SongwriterResult {
  if (!spec.title?.trim()) throw new Error('Give the song a title.');
  if (!Array.isArray(spec.tracks) || !spec.tracks.length) throw new Error('A song needs at least one track.');
  if (spec.tracks.length > MAX_SONG_TRACKS) throw new Error(`A song can have at most ${MAX_SONG_TRACKS} tracks.`);
  const tracks = spec.tracks.map(trackFromSpec);
  const ts = spec.timeSignature ?? [4, 4];
  if (!Number.isInteger(ts[0]) || ts[0] < 1 || ts[0] > 32 || ![1, 2, 4, 8, 16, 32].includes(ts[1])) throw new Error('timeSignature must look like [4, 4] or [6, 8].');

  const seen = new Set<number>();
  for (const p of spec.parts ?? []) {
    if (!Number.isInteger(p.track) || p.track < 1 || p.track > tracks.length) throw new Error(`A part names track ${p.track}; the song has tracks 1 to ${tracks.length}.`);
    if (seen.has(p.track)) throw new Error(`Track ${p.track} has two parts. Send one part per track with all its bars.`);
    seen.add(p.track);
  }
  const parts = (spec.parts ?? []).map((p) => aiPart(p, tracks[p.track - 1].kind as SongInstrument, tracks[p.track - 1].name, p.track));
  const count = Math.max(1, ...parts.map((p) => p.bars.length));
  if (count > MAX_SONG_BARS) throw new Error(`Write at most ${MAX_SONG_BARS} bars at once; add the rest with write_bars.`);
  if (!parts.some(hasNotes)) throw new Error('The song has no notes yet.');

  let doc = newSongDoc({ title: spec.title, artist: spec.artist ?? '', tempo: clampTempo(spec.tempo ?? 120), ts: [ts[0], ts[1]], tracks, bars: count });
  const ctx: RiffCheckContext = { key: null, barQuarters: Array.from({ length: count }, () => (ts[0] * 4) / ts[1]), tracks: tracks.map((t) => ({ kind: t.kind, tuning: [...t.tuning] })) };
  const problems = problemsFor(parts, count, ctx);
  const written = writeParts(doc, parts, { replace: { from: 0, to: count - 1 } }, count);
  doc = written.doc;
  for (const s of spec.sections ?? []) {
    const bar = doc.bars[s.bar - 1];
    if (bar && s.name?.trim()) bar.section = s.name.trim().slice(0, 40);
  }
  return { doc, problems, fixes: written.fixes };
}

export type WriteBarsWhere = { mode: 'improve'; fromBar: number; toBar: number } | { mode: 'generate'; atBar?: number };

export interface WriteBarsResult extends SongwriterResult {
  /** 1-based bars the new music now occupies. */
  fromBar: number;
  toBar: number;
  /** "Guitar and Bass (new track)". */
  wrote: string;
}

/**
 * Writes bars into an existing song, like the riff assistant does: improve replaces bars fromBar..toBar
 * on the tracks the parts write; generate fills bars that are still empty on those tracks from
 * atBar on (default: after the last bar) and inserts before any bar that has notes. A part with
 * track 0 adds a new track.
 */
export function writeBars(doc: SongDoc, where: WriteBarsWhere, partsIn: ToolPart[]): WriteBarsResult {
  if (!Array.isArray(partsIn) || !partsIn.length) throw new Error('Send at least one part.');
  if (partsIn.length > MAX_RIFF_PARTS) throw new Error(`Write at most ${MAX_RIFF_PARTS} parts per call.`);
  const parts = partsIn.map((p, i): AiPart => {
    const existing = p.track > 0 ? doc.tracks[p.track - 1] : undefined;
    if (p.track > 0 && !existing) throw new Error(`Part ${i + 1} names track ${p.track}; the song has tracks 1 to ${doc.tracks.length}. Use 0 for a new track.`);
    const kind = (existing?.kind ?? p.instrument) as SongInstrument;
    if (!RIFF_INSTRUMENTS.includes(kind)) throw new Error(existing ? `Track ${p.track} is a ${existing.kind}; the songwriter writes ${RIFF_INSTRUMENTS.join(', ')} tracks.` : `Part ${i + 1}: a new track needs an instrument (${RIFF_INSTRUMENTS.join(', ')}).`);
    if (p.instrument && existing && p.instrument !== existing.kind) throw new Error(`Part ${i + 1}: track ${p.track} is a ${existing.kind}, not a ${p.instrument}.`);
    return aiPart(p, kind, p.name ?? existing?.name ?? '', p.track);
  });
  const count = Math.max(0, ...parts.map((p) => p.bars.length));
  if (!count) throw new Error('The parts have no bars.');
  if (count > MAX_WRITE_BARS) throw new Error(`Write at most ${MAX_WRITE_BARS} bars per call.`);
  if (!parts.some(hasNotes)) throw new Error('The parts have no notes.');

  let target: RiffTarget;
  let from: number;
  if (where.mode === 'improve') {
    const a = Math.round(where.fromBar) - 1;
    const b = Math.round(where.toBar) - 1;
    if (!(a >= 0 && b >= a && b < doc.bars.length)) throw new Error(`fromBar and toBar must be bars 1 to ${doc.bars.length}, fromBar first.`);
    target = { replace: { from: a, to: b } };
    from = a;
  } else {
    from = Math.min(Math.max(0, Math.round(where.atBar ?? doc.bars.length + 1) - 1), doc.bars.length);
    target = { at: from };
  }
  const problems = problemsFor(parts, count, checkContext(doc, from, count));
  const riff = riffFromAnswer({ explanation: '', parts }, doc, target, count);
  const edit = applyRiff(doc, { track: 0, bar: 0, beat: 0, string: 1 }, target, riff);
  return { doc: edit.doc, problems, fixes: riff.fixes, fromBar: edit.range.from + 1, toBar: edit.range.to + 1, wrote: describeWritten(edit.written, edit.doc) };
}

/** The writing rules for MCP clients: the riff assistant's rules, phrased for whole songs. */
export const SONGWRITER_GUIDE = `How to write tab for Fretlane:
- Notes are tab: each note is a string and a fret. String 1 is the highest-pitched string. Use only the strings the track's tuning has, frets 0 to 24.
- Drums: each note is one drum hit, named with "drum" (kick, snare, closedHiHat, openHiHat, pedalHiHat, crash, ride, highTom, midTom, floorTom, sideStick); no string, fret or techniques. Hits on one beat are played together; at most four, and one hi-hat sound at a time.
- A beat has a duration (1 = whole, 2 = half, 4 = quarter, 8 = eighth, 16 = sixteenth, 32), optionally dotted (x1.5) or triplet (three in the time of two, so triplets come in groups of three). A beat with no notes is a rest.
- Every bar must add up exactly to the time signature: in 4/4 four quarters, eight eighths or sixteen sixteenths; in 6/8 six eighths. Count every bar.
- Techniques (guitar and bass): hammer, slide (into the next note on that string), vibrato, bend (full tone), palmMute, letRing, dead (muted), tie (holds the previous note on that string, same fret). Use them where a player would.
- Write idiomatic, playable parts: realistic hand positions, no stretch wider than about five frets in one chord, no jumps around the neck without a reason. The bass locks in with the kick and the riff's roots, the drums support the rhythm, a second guitar harmonises or answers.
- Every part of a song or of one write_bars call covers the same bars.
- The tools check the result like Fretlane's own assistant does. When they report problems, fix them and send it again.`;
