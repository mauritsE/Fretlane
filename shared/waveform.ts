/**
 * Waveform maths for placing sync pins on an audio file: a compact peak envelope of the whole
 * recording, the slice of it a view shows, and finding the attack of the note nearest to a click.
 */

/** Peak envelope: for every bucket the lowest and highest sample, interleaved as [min0, max0, min1, max1, …]. */
export interface Peaks {
  data: Float32Array;
  bucketsPerSec: number;
  /** Seconds. */
  duration: number;
}

/** 5 ms buckets: fine enough to see a pick attack, small enough for a long song (≈ 0.5 MB for 5 minutes). */
export const BUCKETS_PER_SEC = 200;

/** Reduces decoded audio (one Float32Array per channel) to a peak envelope, mixing the channels. */
export function computePeaks(channels: Float32Array[], sampleRate: number, bucketsPerSec = BUCKETS_PER_SEC): Peaks {
  const length = channels[0]?.length ?? 0;
  const buckets = Math.ceil((length / sampleRate) * bucketsPerSec);
  const data = new Float32Array(buckets * 2);
  const perBucket = sampleRate / bucketsPerSec;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * perBucket);
    const to = Math.min(length, Math.floor((b + 1) * perBucket));
    let lo = 0;
    let hi = 0;
    for (let i = from; i < to; i++) {
      let v = 0;
      for (const ch of channels) v += ch[i];
      v /= channels.length;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    data[b * 2] = lo;
    data[b * 2 + 1] = hi;
  }
  return { data, bucketsPerSec, duration: length / sampleRate };
}

/**
 * The envelope between `from` and `to` seconds squeezed into `columns` pixel columns, as
 * [min, max] per column. Time outside the recording (before 0, after the end) is silence.
 */
export function peaksInRange(peaks: Peaks, from: number, to: number, columns: number): Float32Array {
  const out = new Float32Array(columns * 2);
  const buckets = peaks.data.length / 2;
  const span = (to - from) / columns;
  for (let c = 0; c < columns; c++) {
    const b0 = Math.floor((from + c * span) * peaks.bucketsPerSec);
    // At high zoom a column is narrower than a bucket; always look at the bucket under it.
    const b1 = Math.max(b0 + 1, Math.floor((from + (c + 1) * span) * peaks.bucketsPerSec));
    let lo = 0;
    let hi = 0;
    for (let b = Math.max(0, b0); b < Math.min(buckets, b1); b++) {
      if (peaks.data[b * 2] < lo) lo = peaks.data[b * 2];
      if (peaks.data[b * 2 + 1] > hi) hi = peaks.data[b * 2 + 1];
    }
    out[c * 2] = lo;
    out[c * 2 + 1] = hi;
  }
  return out;
}

/** Loudness per bucket (the larger of |min| and |max|). */
function level(peaks: Peaks, b: number): number {
  return Math.max(-peaks.data[b * 2], peaks.data[b * 2 + 1]);
}

/**
 * The start of the note attack nearest to `time`, within `radius` seconds: the bucket where the
 * level jumps up the most. Returns null when nothing in reach is clearly an attack (a jump of less
 * than `minJump`, e.g. in a sustained chord or silence), so a click then stays where it was.
 */
export function nearestOnset(peaks: Peaks, time: number, radius = 0.08, minJump = 0.05): number | null {
  const buckets = peaks.data.length / 2;
  const center = Math.round(time * peaks.bucketsPerSec);
  const reach = Math.round(radius * peaks.bucketsPerSec);
  let best = -1;
  let bestScore = 0;
  for (let b = Math.max(1, center - reach); b <= Math.min(buckets - 1, center + reach); b++) {
    // Compare with the quietest of the few buckets before, so a fast rise over 2–3 buckets still counts.
    let before = level(peaks, b - 1);
    for (let k = 2; k <= 3 && b - k >= 0; k++) before = Math.min(before, level(peaks, b - k));
    const jump = level(peaks, b) - before;
    // Prefer the closer of two similar attacks.
    const score = jump * (1 - (0.3 * Math.abs(b - center)) / Math.max(1, reach));
    if (jump >= minJump && score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  if (best < 0) return null;
  // The comparison above looks a few buckets back, so the buckets just after an attack score too.
  // The attack itself is where the level rises most in a single step.
  let onset = best;
  for (let b = Math.max(1, best - 3); b <= best; b++) {
    if (level(peaks, b) - level(peaks, b - 1) > level(peaks, onset) - level(peaks, onset - 1)) onset = b;
  }
  return onset / peaks.bucketsPerSec;
}

/** The time window a detail view shows: `span` seconds around `center`, kept inside the recording (from 0 when it is shorter). */
export function viewWindow(center: number, span: number, duration: number): { from: number; to: number } {
  const from = duration > span ? Math.min(Math.max(0, center - span / 2), duration - span) : 0;
  return { from, to: from + span };
}
