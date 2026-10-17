/**
 * Estimates a song's key and the chord in each bar from its notes, for the songwriting assistant:
 * Claude gets them with the song so it doesn't have to work them out from fret numbers, and the
 * riff checks (riffCheck.ts) use the key's scale. These are estimates; the prompt says so.
 */
import type { DocBar, SongDoc } from './doc.ts';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Krumhansl–Kessler key profiles: how strongly each scale degree belongs to a major or minor key. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
/** Natural minor plus the raised seventh, which minor-key music borrows all the time. */
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 11];
/** Fewer notes than this don't tell a key. */
const MIN_NOTES = 8;

export interface SongKey {
  /** e.g. "E minor". */
  name: string;
  /** The key's scale as pitch classes (0 = C). */
  pitchClasses: number[];
}

export const pitchClassName = (pc: number) => NAMES[((pc % 12) + 12) % 12];

function correlation(a: number[], b: number[]): number {
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** The best-fitting key for pitch-class weights (durations), or null when they say too little. */
export function estimateKey(weights: number[], notes: number): SongKey | null {
  if (notes < MIN_NOTES) return null;
  let best: { score: number; tonic: number; minor: boolean } | null = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = weights.map((_, i) => weights[(i + tonic) % 12]);
    for (const minor of [false, true]) {
      const score = correlation(rotated, minor ? MINOR_PROFILE : MAJOR_PROFILE);
      if (!best || score > best.score) best = { score, tonic, minor };
    }
  }
  if (!best || best.score < 0.5) return null;
  const scale = best.minor ? MINOR_SCALE : MAJOR_SCALE;
  return { name: `${pitchClassName(best.tonic)} ${best.minor ? 'minor' : 'major'}`, pitchClasses: scale.map((d) => (d + best!.tonic) % 12).sort((a, b) => a - b) };
}

/**
 * The chord pitch-class weights spell, e.g. "Em", "C" or "E5" (root and fifth only, as in power
 * chords), or null for a bar without notes. `bass` is the lowest pitch class, which usually is the
 * root.
 */
export function chordName(weights: number[], bass: number | null): string | null {
  const total = weights.reduce((s, w) => s + w, 0);
  if (!total) return null;
  let best: { score: number; root: number; third: number } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const third of [4, 3]) {
      const tones = [0, third, 7].map((d) => (root + d) % 12);
      const inChord = tones.reduce((s, pc) => s + weights[pc], 0);
      const score = inChord - 0.6 * (total - inChord) + (bass === root ? 0.3 * total : 0) + (weights[root] > 0 ? 0.1 * total : 0);
      if (!best || score > best.score) best = { score, root, third };
    }
  }
  const { root, third } = best!;
  const thirds = weights[(root + 3) % 12] + weights[(root + 4) % 12];
  // No third to speak of: a power chord (or a bare riff on the root and fifth).
  if (thirds < 0.1 * total) return `${pitchClassName(root)}5`;
  return `${pitchClassName(root)}${third === 3 ? 'm' : ''}`;
}

/** Pitch-class weights (by duration) of one bar's notes on every string track, and its lowest pitch. */
function barWeights(doc: SongDoc, bar: DocBar): { weights: number[]; notes: number; bass: number | null } {
  const weights = Array<number>(12).fill(0);
  let notes = 0;
  let low = Infinity;
  doc.tracks.forEach((t, ti) => {
    if (t.kind === 'drums') return;
    for (const beat of bar.tracks[ti] ?? []) {
      const len = (4 / beat.duration) * (beat.dotted ? 1.5 : 1) * (beat.triplet ? 2 / 3 : 1);
      for (const n of beat.notes) {
        if (n.dead || n.tie) continue;
        const pitch = t.tuning[n.string - 1] + n.fret;
        if (!Number.isFinite(pitch)) continue;
        weights[pitch % 12] += len;
        notes++;
        low = Math.min(low, pitch);
      }
    }
  });
  return { weights, notes, bass: Number.isFinite(low) ? low % 12 : null };
}

/** The song's estimated key and each bar's estimated chord (null for bars without notes). */
export function songHarmony(doc: SongDoc): { key: SongKey | null; chords: (string | null)[] } {
  const all = Array<number>(12).fill(0);
  let notes = 0;
  const chords = doc.bars.map((bar) => {
    const w = barWeights(doc, bar);
    w.weights.forEach((v, i) => (all[i] += v));
    notes += w.notes;
    return chordName(w.weights, w.bass);
  });
  return { key: estimateKey(all, notes), chords };
}

/** "Chords (estimated from the notes): bars 1–2 Em, bar 3 C, bars 4–5 D5." Null without any. */
export function chordsText(chords: (string | null)[]): string | null {
  const runs: string[] = [];
  let i = 0;
  while (i < chords.length) {
    let j = i;
    while (j + 1 < chords.length && chords[j + 1] === chords[i]) j++;
    if (chords[i]) runs.push(`${i === j ? `bar ${i + 1}` : `bars ${i + 1}–${j + 1}`} ${chords[i]}`);
    i = j + 1;
  }
  return runs.length ? `Chords (estimated from the notes): ${runs.join(', ')}.` : null;
}
