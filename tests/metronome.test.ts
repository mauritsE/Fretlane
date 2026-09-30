import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MAX_BPM,
  MIN_BPM,
  clampBpm,
  clickAt,
  clickInterval,
  clicksInWindow,
  normalizeSettings,
  tapTempo,
} from '../shared/metronome.ts';

describe('clampBpm / normalizeSettings', () => {
  it('clamps and rounds', () => {
    expect(clampBpm(10)).toBe(MIN_BPM);
    expect(clampBpm(999)).toBe(MAX_BPM);
    expect(clampBpm(120.4)).toBe(120);
    expect(clampBpm(NaN)).toBe(DEFAULT_SETTINGS.bpm);
  });
  it('repairs saved settings', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ bpm: 500, beatsPerBar: 0, subdivision: 5 as 1, volume: 3, accent: false })).toEqual({
      bpm: MAX_BPM,
      beatsPerBar: 4,
      subdivision: 1,
      accent: false,
      volume: 1,
    });
  });
});

describe('tapTempo', () => {
  it('needs two taps', () => {
    expect(tapTempo([])).toBeNull();
    expect(tapTempo([1000])).toBeNull();
  });
  it('averages the intervals', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 480, 1010, 1500])).toBe(120);
  });
  it('starts over after a pause', () => {
    expect(tapTempo([0, 1000, 5000, 5250, 5500])).toBe(240);
    expect(tapTempo([0, 1000, 5000])).toBeNull();
  });
  it('uses at most the last 8 taps', () => {
    const slowThenFast = [0, 1000, 2000, ...Array.from({ length: 8 }, (_, i) => 2500 + i * 500)];
    expect(tapTempo(slowThenFast)).toBe(120);
  });
});

describe('click schedule', () => {
  const s = { ...DEFAULT_SETTINGS, bpm: 120, beatsPerBar: 3, subdivision: 2 as const };

  it('spaces clicks by tempo and subdivision', () => {
    expect(clickInterval({ bpm: 120, subdivision: 1 })).toBe(0.5);
    expect(clickInterval({ bpm: 120, subdivision: 2 })).toBe(0.25);
  });

  it('accents the first beat of each bar', () => {
    const kinds = Array.from({ length: 7 }, (_, i) => clickAt(i, s));
    expect(kinds.map((k) => k.kind)).toEqual(['accent', 'sub', 'beat', 'sub', 'beat', 'sub', 'accent']);
    expect(kinds.map((k) => k.beat)).toEqual([0, 0, 1, 1, 2, 2, 0]);
    expect(clickAt(0, { ...s, accent: false }).kind).toBe('beat');
  });

  it('returns each click once across consecutive windows', () => {
    const start = 10;
    let next = 0;
    const got: number[] = [];
    for (let k = 0; k < 20; k++) {
      const clicks = clicksInWindow(start, next, 10 + k / 10, 10 + (k + 1) / 10, s);
      for (const c of clicks) got.push(c.index);
      if (clicks.length) next = clicks[clicks.length - 1].index + 1;
    }
    expect(got).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(clicksInWindow(start, 0, 10, 10.6, s).map((c) => c.time)).toEqual([10, 10.25, 10.5]);
  });

  it('skips clicks that are already in the past', () => {
    // Clicks every 0.5 s: the one at 1.0 s is past, 1.5 s is the next.
    const clicks = clicksInWindow(0, 0, 1.01, 1.6, { ...s, subdivision: 1 });
    expect(clicks.map((c) => c.index)).toEqual([3]);
  });
});
