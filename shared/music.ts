/**
 * Small music-theory toolkit for generating playable tabs: pitch names, durations, guitar
 * fingering and chord shapes. Pure functions so vitest can cover them.
 */

/** Guitar and bass tunings, highest string first (alphaTex string 1 = highest). MIDI pitches. */
export const GUITAR_STANDARD = [64, 59, 55, 50, 45, 40];
export const BASS_STANDARD = [43, 38, 33, 28];
/** alphaTex spelling of the tunings above. */
export const GUITAR_STANDARD_TEX = '(e4 b3 g3 d3 a2 e2)';
export const BASS_STANDARD_TEX = '(g2 d2 a1 e1)';

const PITCH_CLASS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** Parses "C4", "F#3", "Bb5" (scientific pitch notation, C4 = MIDI 60) into a MIDI number. */
export function parsePitch(name: string): number {
  const m = /^([A-Ga-g])(#|b)?(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Not a pitch: "${name}"`);
  const pc = PITCH_CLASS[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (Number(m[3]) + 1) * 12 + pc;
}

/** Pitch class (0 = C) of a chord root such as "F#" or "Bb". */
export function parsePitchClass(name: string): number {
  return (parsePitch(`${name}4`) % 12 + 12) % 12;
}

export const QUARTER = 960;

/** Ticks of a note value (1 = whole, 4 = quarter), optionally dotted or a triplet. */
export function durationTicks(value: number, dotted = false, triplet = false): number {
  let t = (QUARTER * 4) / value;
  if (dotted) t *= 1.5;
  if (triplet) t = (t * 2) / 3;
  return t;
}

export interface NoteValue {
  value: number;
  dotted: boolean;
}

/** Splits a length in ticks into as few plain or dotted note values as possible (for ties). */
export function splitTicks(ticks: number): NoteValue[] {
  const options: (NoteValue & { ticks: number })[] = [];
  for (const value of [1, 2, 4, 8, 16, 32]) {
    options.push({ value, dotted: true, ticks: durationTicks(value, true) });
    options.push({ value, dotted: false, ticks: durationTicks(value) });
  }
  const out: NoteValue[] = [];
  let rest = ticks;
  while (rest > 0) {
    const pick = options.find((o) => o.ticks <= rest);
    if (!pick) throw new Error(`Cannot express ${ticks} ticks in note values`);
    out.push({ value: pick.value, dotted: pick.dotted });
    rest -= pick.ticks;
  }
  return out;
}

/** A note on a fretted instrument. `string` uses alphaTex numbering: 1 is the highest string. */
export interface Fretted {
  string: number;
  fret: number;
}

export interface FingeringOptions {
  tuning?: number[];
  maxFret?: number;
  /** Fret the hand should stay around (e.g. 5 for fifth position). Defaults to open position. */
  position?: number;
}

function candidates(pitch: number, tuning: number[], maxFret: number): Fretted[] {
  const out: Fretted[] = [];
  tuning.forEach((open, i) => {
    const fret = pitch - open;
    if (fret >= 0 && fret <= maxFret) out.push({ string: i + 1, fret });
  });
  return out;
}

/** Every way to play a set of pitches at once on distinct strings. */
function chordCandidates(pitches: number[], tuning: number[], maxFret: number): Fretted[][] {
  const per = pitches.map((p) => candidates(p, tuning, maxFret));
  const out: Fretted[][] = [];
  const walk = (i: number, used: Set<number>, acc: Fretted[]) => {
    if (i === per.length) {
      const fretted = acc.filter((n) => n.fret > 0).map((n) => n.fret);
      if (!fretted.length || Math.max(...fretted) - Math.min(...fretted) <= 4) out.push([...acc]);
      return;
    }
    for (const c of per[i]) {
      if (used.has(c.string)) continue;
      used.add(c.string);
      acc.push(c);
      walk(i + 1, used, acc);
      acc.pop();
      used.delete(c.string);
    }
  };
  walk(0, new Set(), []);
  return out;
}

/** Where the fretting hand is for a shape, or null when only open strings are played. */
function handFret(shape: Fretted[]): number | null {
  const f = shape.filter((n) => n.fret > 0).map((n) => n.fret);
  return f.length ? Math.min(...f) : null;
}

/**
 * Chooses string/fret positions for a sequence of notes (single pitches or chords) so the hand
 * moves as little as possible and stays near the preferred position. Viterbi over all candidates.
 */
export function fingerSequence(events: number[][], opts: FingeringOptions = {}): Fretted[][] {
  const tuning = opts.tuning ?? GUITAR_STANDARD;
  const maxFret = opts.maxFret ?? 15;
  const position = opts.position ?? 0;
  if (!events.length) return [];
  const layers = events.map((pitches) => {
    const c = chordCandidates(pitches, tuning, maxFret);
    if (!c.length) throw new Error(`Pitches ${pitches.join(',')} cannot be played on this instrument`);
    return c;
  });
  const unary = (shape: Fretted[]): number => {
    let cost = 0;
    for (const n of shape) {
      if (n.fret === 0) {
        cost += position > 3 ? 0.4 : 0; // open strings are fine in open position, less so higher up
      } else {
        const below = position - n.fret;
        const above = n.fret - (Math.max(position, 1) + 3);
        cost += 0.05 * n.fret + (below > 0 ? below * 0.6 : 0) + (above > 0 ? above * 0.6 : 0);
      }
    }
    return cost;
  };
  const move = (a: Fretted[], b: Fretted[]): number => {
    const ha = handFret(a);
    const hb = handFret(b);
    let cost = 0;
    if (ha !== null && hb !== null) {
      const d = Math.abs(ha - hb);
      cost += d * 0.5 + (d > 3 ? 2 : 0);
    }
    // Jumping across strings is harder than moving to a neighbouring one.
    cost += Math.abs(a[0].string - b[0].string) * 0.05;
    return cost;
  };
  let costs = layers[0].map(unary);
  const back: number[][] = [layers[0].map(() => -1)];
  for (let i = 1; i < layers.length; i++) {
    const next: number[] = [];
    const ptr: number[] = [];
    for (const shape of layers[i]) {
      let best = Infinity;
      let arg = 0;
      layers[i - 1].forEach((prev, j) => {
        const c = costs[j] + move(prev, shape);
        if (c < best) {
          best = c;
          arg = j;
        }
      });
      next.push(best + unary(shape));
      ptr.push(arg);
    }
    costs = next;
    back.push(ptr);
  }
  let idx = costs.indexOf(Math.min(...costs));
  const out: Fretted[][] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    out.unshift(layers[i][idx]);
    idx = back[i][idx];
  }
  return out;
}

/** Open and barre chord shapes, low E to high e, one character per string ("x" = not played). */
const SHAPES: Record<string, string> = {
  A: 'x02220', Am: 'x02210', A7: 'x02020', Am7: 'x02010', Asus4: 'x02230', Asus2: 'x02200',
  B: 'x24442', Bm: 'x24432', B7: 'x21202', Bb: 'x13331', Bdim: 'x2343x',
  C: 'x32010', C7: 'x32310', Cmaj7: 'x32000', Cm: 'x35543',
  'C#m': 'x46654', 'C#dim': 'x4535x',
  D: 'xx0232', Dm: 'xx0231', D7: 'xx0212', Dsus4: 'xx0233', Dm7: 'xx0211',
  E: '022100', Em: '022000', E7: '020100', Em7: '022030', Esus4: '022200',
  Eb: 'x65343',
  F: '133211', Fm: '133111', Fmaj7: 'xx3210', F7: '131211',
  'F#m': '244222', 'F#': '244322', 'F#7': '242322', 'F#dim': '2342xx',
  G: '320003', G7: '320001', Gm: '355333', Gsus4: '330013',
  'G#dim': '4564xx', 'G#': '466544', 'G#7': '464544',
  Ab: '466544',
};

export function knownChords(): string[] {
  return Object.keys(SHAPES);
}

/** The shape of a chord as fretted notes (alphaTex strings, high e = 1), low string first. */
export function chordShape(name: string): Fretted[] {
  const shape = SHAPES[name];
  if (!shape) throw new Error(`Unknown chord "${name}"`);
  const out: Fretted[] = [];
  [...shape].forEach((ch, i) => {
    if (ch !== 'x') out.push({ string: 6 - i, fret: Number(ch) });
  });
  return out;
}

/** Root pitch class of a chord symbol such as "F#m7" or "Bb". */
export function chordRoot(name: string): number {
  const m = /^([A-G](?:#|b)?)/.exec(name);
  if (!m) throw new Error(`Not a chord: "${name}"`);
  return parsePitchClass(m[1]);
}

/** Pitch of the chord's fifth relative to the root, 7 semitones, except for diminished chords. */
export function chordFifth(name: string): number {
  return /dim/.test(name) ? 6 : 7;
}

/** Lowest playable pitch with this pitch class at or above `floor`. */
export function pitchAtOrAbove(pc: number, floor: number): number {
  let p = floor;
  while (((p % 12) + 12) % 12 !== pc) p++;
  return p;
}

/** A two-note power chord (root + fifth) on the low E or A string. */
export function powerChord(name: string): Fretted[] {
  const root = chordRoot(name);
  const onE = (root - 4 + 12) % 12; // fret on the low E string
  if (onE <= 7) return [{ string: 6, fret: onE }, { string: 5, fret: onE + 2 }];
  const onA = (root - 9 + 12) % 12;
  return [{ string: 5, fret: onA }, { string: 4, fret: onA + 2 }];
}

/** MIDI pitch of a fretted note. */
export function fretPitch(n: Fretted, tuning: number[] = GUITAR_STANDARD): number {
  return tuning[n.string - 1] + n.fret;
}
