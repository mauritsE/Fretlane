/**
 * The tab editor's document model: a small, plain-data description of a song written in Fretlane.
 * Edits are pure functions on it (commands.ts), it turns into alphaTex for alphaTab to render and
 * play (tex.ts), and it is read back from a parsed score when a written song is opened (fromScore.ts).
 *
 * Documents are treated as immutable: a command copies what it changes, so undo is a stack of
 * earlier documents.
 */
import { QUARTER } from '../music.ts';

/** Note values the editor offers: 1 = whole … 32 = thirty-second. */
export const DURATIONS = [1, 2, 4, 8, 16, 32] as const;
export type DurationValue = (typeof DURATIONS)[number];

export type TrackKind = 'guitar' | 'bass';

export interface DocNote {
  /** alphaTex string number: 1 = the highest string (top line of the tab). */
  string: number;
  fret: number;
  /** Tied to the previous note on this string (the fret is shown in brackets and not re-picked). */
  tie?: boolean;
  dead?: boolean;
  /** Hammer-on or pull-off to the next note on this string. */
  hammer?: boolean;
  /** Legato slide to the next note on this string. */
  slide?: boolean;
  vibrato?: boolean;
  /** A full-tone bend. */
  bend?: boolean;
  palmMute?: boolean;
  letRing?: boolean;
}

export interface DocBeat {
  duration: DurationValue;
  dotted?: boolean;
  /** Part of a triplet (three in the time of two). */
  triplet?: boolean;
  /** Empty means a rest. Sorted by string. */
  notes: DocNote[];
}

export interface DocBar {
  /** Time signature, e.g. [4, 4]. */
  ts: [number, number];
  repeatStart?: boolean;
  /** Ends a repeat played this many times in total (2 = play twice). */
  repeatEnd?: number;
  /** A section name shown above the bar, e.g. "Verse". */
  section?: string;
  /** A tempo change at the start of this bar (BPM). */
  tempo?: number;
  /** One voice per track, in track order. */
  tracks: DocBeat[][];
}

export interface DocTrack {
  name: string;
  kind: TrackKind;
  /** General MIDI instrument name as alphaTex spells it, e.g. "electricguitarclean". */
  sound: string;
  /** MIDI pitch per string, highest string first (alphaTex order). */
  tuning: number[];
}

export interface SongDoc {
  title: string;
  artist: string;
  tempo: number;
  tracks: DocTrack[];
  bars: DocBar[];
}

/** Ticks (960 per quarter note) a beat lasts. */
export function beatTicks(beat: Pick<DocBeat, 'duration' | 'dotted' | 'triplet'>): number {
  let t = (QUARTER * 4) / beat.duration;
  if (beat.dotted) t *= 1.5;
  if (beat.triplet) t = (t * 2) / 3;
  return Math.round(t);
}

/** Ticks a bar with this time signature should hold. */
export function barTicks(ts: [number, number]): number {
  return Math.round(((QUARTER * 4) / ts[1]) * ts[0]);
}

export function voiceTicks(beats: DocBeat[]): number {
  return beats.reduce((sum, b) => sum + beatTicks(b), 0);
}

/**
 * Rests that fill `ticks`, longest first, using plain and dotted values (e.g. 3/4 → one dotted
 * half). Whatever no rest can express (less than a 1/32 triplet) is dropped.
 */
export function restsFor(ticks: number): DocBeat[] {
  const out: DocBeat[] = [];
  let left = Math.round(ticks);
  // Longest first; on equal length a plain value beats a dotted one beats a triplet.
  const options: DocBeat[] = DURATIONS.flatMap((duration): DocBeat[] => [
    { duration, notes: [] },
    { duration, dotted: true, notes: [] },
    { duration, triplet: true, notes: [] },
  ]).sort((a, b) => beatTicks(b) - beatTicks(a));
  while (left > 0) {
    const fit = options.find((o) => beatTicks(o) <= left);
    if (!fit) break;
    out.push({ ...fit, notes: [] });
    left -= beatTicks(fit);
  }
  return out;
}

export function emptyBar(ts: [number, number], trackCount: number): DocBar {
  return { ts: [ts[0], ts[1]], tracks: Array.from({ length: trackCount }, () => restsFor(barTicks(ts))) };
}

export interface BarStatus {
  /** Ticks the voice holds. */
  actual: number;
  /** Ticks the time signature asks for. */
  expected: number;
  /** actual - expected: negative = too short, positive = too long. */
  diff: number;
}

export function barStatus(doc: SongDoc, track: number, bar: number): BarStatus {
  const b = doc.bars[bar];
  const actual = voiceTicks(b.tracks[track] ?? []);
  const expected = barTicks(b.ts);
  return { actual, expected, diff: actual - expected };
}

/** "an eighth", "a dotted quarter", "3 sixteenths": how much a bar is off, in words. */
export function describeTicks(ticks: number): string {
  const t = Math.abs(Math.round(ticks));
  const names: [number, string][] = [
    [QUARTER * 4, 'whole'],
    [QUARTER * 2, 'half'],
    [QUARTER, 'quarter'],
    [QUARTER / 2, 'eighth'],
    [QUARTER / 4, 'sixteenth'],
    [QUARTER / 8, 'thirty-second'],
  ];
  for (const [size, name] of names) {
    if (t === size) return `a${name === 'eighth' ? 'n' : ''} ${name}`;
    if (t === size * 1.5) return `a dotted ${name}`;
  }
  for (const [size, name] of names) {
    if (t % size === 0) return `${t / size} ${name}s`;
  }
  return `${t} ticks`;
}

export interface TuningPreset {
  id: string;
  label: string;
  kind: TrackKind;
  /** Highest string first. */
  tuning: number[];
}

export const TUNING_PRESETS: TuningPreset[] = [
  { id: 'guitar-standard', label: 'Standard (E A D G B E)', kind: 'guitar', tuning: [64, 59, 55, 50, 45, 40] },
  { id: 'guitar-drop-d', label: 'Drop D (D A D G B E)', kind: 'guitar', tuning: [64, 59, 55, 50, 45, 38] },
  { id: 'guitar-half-down', label: 'Half step down (Eb Ab Db Gb Bb Eb)', kind: 'guitar', tuning: [63, 58, 54, 49, 44, 39] },
  { id: 'guitar-d-standard', label: 'D standard (D G C F A D)', kind: 'guitar', tuning: [62, 57, 53, 48, 43, 38] },
  { id: 'guitar-dadgad', label: 'DADGAD', kind: 'guitar', tuning: [62, 57, 55, 50, 45, 38] },
  { id: 'guitar-open-g', label: 'Open G (D G D G B D)', kind: 'guitar', tuning: [62, 59, 55, 50, 43, 38] },
  { id: 'guitar-7-standard', label: '7-string standard (B E A D G B E)', kind: 'guitar', tuning: [64, 59, 55, 50, 45, 40, 35] },
  { id: 'bass-standard', label: 'Standard (E A D G)', kind: 'bass', tuning: [43, 38, 33, 28] },
  { id: 'bass-drop-d', label: 'Drop D (D A D G)', kind: 'bass', tuning: [43, 38, 33, 26] },
  { id: 'bass-5-standard', label: '5-string (B E A D G)', kind: 'bass', tuning: [43, 38, 33, 28, 23] },
];

export const DEFAULT_SOUND: Record<TrackKind, string> = {
  guitar: 'electricguitarclean',
  bass: 'electricbassfinger',
};

/** Sounds offered per track kind (General MIDI names, as alphaTex spells them). */
export const SOUNDS: Record<TrackKind, { id: string; label: string }[]> = {
  guitar: [
    { id: 'electricguitarclean', label: 'Clean electric' },
    { id: 'overdrivenguitar', label: 'Overdrive' },
    { id: 'distortionguitar', label: 'Distortion' },
    { id: 'acousticguitarsteel', label: 'Acoustic (steel)' },
    { id: 'acousticguitarnylon', label: 'Acoustic (nylon)' },
    { id: 'electricguitarmuted', label: 'Muted electric' },
  ],
  bass: [
    { id: 'electricbassfinger', label: 'Finger bass' },
    { id: 'electricbasspick', label: 'Pick bass' },
    { id: 'fretlessbass', label: 'Fretless' },
    { id: 'acousticbass', label: 'Acoustic bass' },
  ],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** "E2" for MIDI 40. */
export function pitchName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * Parses a custom tuning typed by the user, lowest string first as guitarists say it
 * ("D A D G B E", "B1 E2 A2 D3 G3"). Notes without an octave are placed rising from a sensible
 * lowest string for the instrument. Returns MIDI pitches highest string first, or null.
 */
export function parseTuning(text: string, kind: TrackKind): number[] | null {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length < 4 || parts.length > 8) return null;
  const pcs: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const out: number[] = [];
  let floor = kind === 'bass' ? 21 : 33; // A0 / A1: nothing lower is a sensible lowest string
  for (const part of parts) {
    const m = /^([A-Ga-g])(#|b)?(-?\d)?$/.exec(part);
    if (!m) return null;
    const pc = (pcs[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
    let midi: number;
    if (m[3] !== undefined) {
      midi = (Number(m[3]) + 1) * 12 + pc;
    } else {
      midi = floor + ((pc - floor) % 12 + 12) % 12;
    }
    if (midi < 12 || midi > 96) return null;
    out.push(midi);
    floor = midi + 1;
  }
  return out.reverse();
}

export interface NewSongOptions {
  title: string;
  artist: string;
  tempo: number;
  ts: [number, number];
  tracks: DocTrack[];
  /** Number of empty bars to start with. */
  bars?: number;
}

export function newSongDoc(opts: NewSongOptions): SongDoc {
  const count = Math.max(1, opts.bars ?? 4);
  return {
    title: opts.title.trim() || 'Untitled',
    artist: opts.artist.trim() || 'Me',
    tempo: clampTempo(opts.tempo),
    tracks: opts.tracks.map((t) => ({ ...t, tuning: [...t.tuning] })),
    bars: Array.from({ length: count }, () => emptyBar(opts.ts, opts.tracks.length)),
  };
}

export function clampTempo(bpm: number): number {
  return Math.min(400, Math.max(20, Math.round(Number(bpm) || 120)));
}

export const TIME_SIGNATURES: [number, number][] = [
  [4, 4],
  [3, 4],
  [2, 4],
  [5, 4],
  [6, 8],
  [7, 8],
  [9, 8],
  [12, 8],
];
