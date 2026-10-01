/** Pure metronome maths: tempo limits, tap tempo and the click schedule. Audio lives in src/. */

export const MIN_BPM = 30;
export const MAX_BPM = 260;

export type Subdivision = 1 | 2 | 3 | 4;

export interface MetronomeSettings {
  bpm: number;
  /** Clicks per bar; the first one is accented. */
  beatsPerBar: number;
  /** Clicks per beat: 1 = quarters, 2 = eighths, 3 = triplets, 4 = sixteenths. */
  subdivision: Subdivision;
  accent: boolean;
  /** 0..1 */
  volume: number;
}

export const DEFAULT_SETTINGS: MetronomeSettings = { bpm: 90, beatsPerBar: 4, subdivision: 1, accent: true, volume: 0.8 };

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_SETTINGS.bpm;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

/** Fills in missing or invalid fields, e.g. from settings saved by an older version. */
export function normalizeSettings(input: Partial<MetronomeSettings> | null | undefined): MetronomeSettings {
  const s = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  return {
    bpm: clampBpm(Number(s.bpm)),
    beatsPerBar: Math.min(12, Math.max(1, Math.round(Number(s.beatsPerBar)) || DEFAULT_SETTINGS.beatsPerBar)),
    subdivision: ([1, 2, 3, 4] as const).includes(s.subdivision) ? s.subdivision : 1,
    accent: s.accent !== false,
    volume: Math.min(1, Math.max(0, Number(s.volume))) || 0,
  };
}

/** Taps further apart than this start a new measurement. */
export const TAP_RESET_MS = 2000;

/**
 * Tempo from tap times in milliseconds (oldest first). Uses the taps after the last long pause,
 * at most the last 8, and needs at least two. Returns null when there is nothing to measure.
 */
export function tapTempo(taps: number[]): number | null {
  let start = 0;
  for (let i = 1; i < taps.length; i++) if (taps[i] - taps[i - 1] > TAP_RESET_MS || taps[i] <= taps[i - 1]) start = i;
  const recent = taps.slice(Math.max(start, taps.length - 8));
  if (recent.length < 2) return null;
  const avg = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
  return clampBpm(60000 / avg);
}

export interface Click {
  /** Seconds, on the same clock as `start`. */
  time: number;
  /** Index of the click since start. */
  index: number;
  /** 0-based beat within the bar. */
  beat: number;
  kind: 'accent' | 'beat' | 'sub';
}

/** Seconds between two clicks. */
export function clickInterval(s: Pick<MetronomeSettings, 'bpm' | 'subdivision'>): number {
  return 60 / clampBpm(s.bpm) / s.subdivision;
}

/** What the click with this index is: bar accent, beat, or subdivision. */
export function clickAt(index: number, s: Pick<MetronomeSettings, 'beatsPerBar' | 'subdivision' | 'accent'>): Omit<Click, 'time' | 'index'> {
  const perBar = s.beatsPerBar * s.subdivision;
  const inBar = ((index % perBar) + perBar) % perBar;
  const beat = Math.floor(inBar / s.subdivision);
  if (inBar % s.subdivision !== 0) return { beat, kind: 'sub' };
  return { beat, kind: inBar === 0 && s.accent ? 'accent' : 'beat' };
}

/**
 * Clicks to schedule in the window [from, to) for a metronome that started at `start` (all in
 * seconds), given the index of the next unscheduled click. Used by a look-ahead scheduler, which
 * calls this every few milliseconds with a window slightly ahead of the audio clock.
 */
export function clicksInWindow(start: number, nextIndex: number, from: number, to: number, s: MetronomeSettings): Click[] {
  const step = clickInterval(s);
  const out: Click[] = [];
  let i = Math.max(nextIndex, Math.ceil((from - start) / step - 1e-9));
  for (; start + i * step < to; i++) out.push({ time: start + i * step, index: i, ...clickAt(i, s) });
  return out;
}
