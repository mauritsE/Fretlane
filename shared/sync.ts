import type { SyncPoint } from './types.ts';

/** Shape of alphaTab's FlatSyncPoint (kept local so this module stays framework-free & testable). */
export interface FlatSyncPointLike {
  barIndex: number;
  barPosition: number;
  barOccurence: number;
  millisecondOffset: number;
}

/**
 * Converts the library's bar->seconds pins into alphaTab flat sync points.
 * If the first pin is not on bar 0, a pin for bar 0 is extrapolated backwards using the score's
 * own tempo so bars before the first pin still line up sensibly.
 */
export function toFlatSyncPoints(points: SyncPoint[], barStartMs: (bar: number) => number): FlatSyncPointLike[] {
  const sorted = normalizeSyncPoints(points);
  if (!sorted.length) return [];
  const flat = sorted.map((p) => ({ barIndex: p.bar, barPosition: 0, barOccurence: 0, millisecondOffset: Math.round(p.time * 1000) }));
  if (sorted[0].bar > 0) {
    const shift = barStartMs(sorted[0].bar) - barStartMs(0);
    flat.unshift({ barIndex: 0, barPosition: 0, barOccurence: 0, millisecondOffset: Math.round(sorted[0].time * 1000 - shift) });
  }
  return flat;
}

/** Sort by bar, drop duplicates (last write wins) and drop pins that would run backwards in time. */
export function normalizeSyncPoints(points: SyncPoint[]): SyncPoint[] {
  const byBar = new Map<number, number>();
  for (const p of points) {
    if (Number.isFinite(p.bar) && Number.isFinite(p.time) && p.bar >= 0) byBar.set(Math.floor(p.bar), p.time);
  }
  const out: SyncPoint[] = [];
  for (const [bar, time] of [...byBar.entries()].sort((a, b) => a[0] - b[0])) {
    if (out.length && time <= out[out.length - 1].time) continue;
    out.push({ bar, time });
  }
  return out;
}

/** Adds or replaces the pin for `bar`. */
export function upsertSyncPoint(points: SyncPoint[], bar: number, time: number): SyncPoint[] {
  return normalizeSyncPoints([...points.filter((p) => p.bar !== bar), { bar, time }]);
}

/** Moves every pin by `delta` seconds (for nudging the whole song earlier/later). */
export function shiftSyncPoints(points: SyncPoint[], delta: number): SyncPoint[] {
  return points.map((p) => ({ bar: p.bar, time: Math.max(0, +(p.time + delta).toFixed(3)) }));
}

/**
 * Estimates BPM between two pins given how many quarter notes the bars in between contain.
 * Useful feedback while tapping: it shows whether taps are consistent.
 */
export function bpmBetween(a: SyncPoint, b: SyncPoint, quarterNotesBetween: number): number {
  const dt = b.time - a.time;
  return dt > 0 ? (quarterNotesBetween * 60) / dt : 0;
}
