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

export type TrackKind = 'guitar' | 'bass' | 'ukulele' | 'mandolin' | 'banjo' | 'drums';

/** The instruments a track can be, in the order the editor offers them. */
export const INSTRUMENTS: { kind: TrackKind; label: string }[] = [
  { kind: 'guitar', label: 'Guitar' },
  { kind: 'bass', label: 'Bass' },
  { kind: 'drums', label: 'Drums' },
  { kind: 'ukulele', label: 'Ukulele' },
  { kind: 'mandolin', label: 'Mandolin' },
  { kind: 'banjo', label: 'Banjo' },
];

export function instrumentLabel(kind: TrackKind): string {
  return INSTRUMENTS.find((i) => i.kind === kind)?.label ?? 'Guitar';
}

export interface DrumLane {
  /** General MIDI percussion note. */
  gm: number;
  name: string;
  /**
   * Where alphaTab draws it on the five-line drum staff, in half spaces down from the top line
   * (-2 = the ledger line above, 7 = the bottom space). Read from alphaTab's articulations.
   */
  staffLine: number;
  /** Other GM notes that mean the same drum when reading a tab written elsewhere. */
  aliases?: number[];
}

/**
 * The drum kit a drum track writes to, top lane first. A drum track's "strings" are these lanes:
 * the cursor moves between them like strings, a hit is a note on a lane (its fret is unused), and
 * `DocTrack.tuning` holds the lanes' GM numbers.
 */
export const DRUM_LANES: DrumLane[] = [
  { gm: 49, name: 'Crash', staffLine: -2, aliases: [57, 55, 52] },
  { gm: 46, name: 'Open hi-hat', staffLine: -1 },
  { gm: 42, name: 'Hi-hat', staffLine: -1 },
  { gm: 51, name: 'Ride', staffLine: 0, aliases: [53, 59] },
  { gm: 48, name: 'High tom', staffLine: 2, aliases: [50] },
  { gm: 38, name: 'Snare', staffLine: 3, aliases: [40, 37] },
  { gm: 47, name: 'Mid tom', staffLine: 4, aliases: [45] },
  { gm: 43, name: 'Floor tom', staffLine: 6, aliases: [41] },
  { gm: 36, name: 'Kick', staffLine: 7, aliases: [35] },
  { gm: 44, name: 'Hi-hat pedal', staffLine: 9 },
];

export const DRUM_KIT = DRUM_LANES.map((l) => l.gm);

/** The lane a GM percussion note belongs to (1 = top lane), or 0 when the kit has no such drum. */
export function drumLaneOf(gm: number): number {
  const i = DRUM_LANES.findIndex((l) => l.gm === gm || l.aliases?.includes(gm));
  return i + 1;
}

export function drumLaneName(gm: number): string {
  return DRUM_LANES.find((l) => l.gm === gm)?.name ?? `Drum ${gm}`;
}

/**
 * The lane (1 = top) whose drum sits nearest a staff position, in half spaces down from the top
 * line. Hi-hat and open hi-hat share a position; a click there means the closed hi-hat.
 */
export function drumLaneAt(staffLine: number, lanes: number[] = DRUM_KIT): number {
  let best = 1;
  let bestDist = Infinity;
  lanes.forEach((gm, i) => {
    const line = DRUM_LANES.find((l) => l.gm === gm)?.staffLine ?? 0;
    const dist = Math.abs(line - staffLine);
    if (dist <= bestDist) {
      best = i + 1;
      bestDist = dist;
    }
  });
  return best;
}

export function drumStaffLine(gm: number): number {
  return DRUM_LANES.find((l) => l.gm === gm)?.staffLine ?? 0;
}

/** Where the cursor starts on a track: the lowest string, or the kick on drums. */
export function startString(track: DocTrack): number {
  if (!isDrums(track)) return track.tuning.length;
  return track.tuning.indexOf(36) + 1 || track.tuning.length;
}

export function isDrums(track: Pick<DocTrack, 'kind'> | undefined): boolean {
  return track?.kind === 'drums';
}

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
  /** General MIDI instrument name as alphaTex spells it, e.g. "electricguitarclean"; "percussion" for drums. */
  sound: string;
  /** MIDI pitch per string, highest string first (alphaTex order). For drums: the lanes' GM notes (DRUM_KIT). */
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
  // Ukulele and 5-string banjo are re-entrant: the string at the bottom of the tab is not the lowest.
  { id: 'ukulele-standard', label: 'Standard (G C E A)', kind: 'ukulele', tuning: [69, 64, 60, 67] },
  { id: 'ukulele-low-g', label: 'Low G (G C E A)', kind: 'ukulele', tuning: [69, 64, 60, 55] },
  { id: 'ukulele-baritone', label: 'Baritone (D G B E)', kind: 'ukulele', tuning: [64, 59, 55, 50] },
  { id: 'mandolin-standard', label: 'Standard (G D A E)', kind: 'mandolin', tuning: [76, 69, 62, 55] },
  { id: 'banjo-open-g', label: 'Open G (g D G B D)', kind: 'banjo', tuning: [62, 59, 55, 50, 67] },
  { id: 'banjo-double-c', label: 'Double C (g C G C D)', kind: 'banjo', tuning: [62, 60, 55, 48, 67] },
  { id: 'banjo-tenor', label: 'Tenor (C G D A)', kind: 'banjo', tuning: [69, 62, 55, 48] },
];

export const DEFAULT_SOUND: Record<TrackKind, string> = {
  guitar: 'electricguitarclean',
  bass: 'electricbassfinger',
  // General MIDI has no ukulele or mandolin; these are the closest sounds it has.
  ukulele: 'acousticguitarnylon',
  mandolin: 'acousticguitarsteel',
  banjo: 'banjo',
  drums: 'percussion',
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
  ukulele: [
    { id: 'acousticguitarnylon', label: 'Nylon strings' },
    { id: 'acousticguitarsteel', label: 'Steel strings' },
  ],
  mandolin: [
    { id: 'acousticguitarsteel', label: 'Steel strings' },
    { id: 'acousticguitarnylon', label: 'Nylon strings' },
  ],
  banjo: [{ id: 'banjo', label: 'Banjo' }],
  drums: [{ id: 'percussion', label: 'Drum kit' }],
};

/** A new drum track with the full kit. */
export function drumTrack(name = 'Drums'): DocTrack {
  return { name, kind: 'drums', sound: 'percussion', tuning: [...DRUM_KIT] };
}

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
  if (kind === 'drums') return null;
  // A0 / A1 / G3 / C3: nothing lower is a sensible lowest string.
  let floor = kind === 'bass' ? 21 : kind === 'mandolin' ? 55 : kind === 'ukulele' || kind === 'banjo' ? 48 : 33;
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
