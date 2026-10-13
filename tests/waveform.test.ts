import { describe, expect, it } from 'vitest';
import { computePeaks, nearestOnset, peaksInRange, viewWindow } from '../shared/waveform.ts';

const RATE = 8000;

/** Silence with short decaying 440 Hz plucks starting at the given times. */
function plucks(seconds: number, at: number[], amp = 0.8): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (const t of at) {
    const start = Math.round(t * RATE);
    for (let i = 0; i < RATE * 0.3 && start + i < out.length; i++) {
      out[start + i] += amp * Math.exp(-i / (RATE * 0.08)) * Math.sin((2 * Math.PI * 440 * i) / RATE);
    }
  }
  return out;
}

describe('computePeaks', () => {
  it('keeps the min and max per 5 ms bucket and the duration', () => {
    const p = computePeaks([plucks(2, [1])], RATE);
    expect(p.duration).toBe(2);
    expect(p.data.length).toBe(2 * 400);
    expect(p.data[0]).toBe(0); // silence before the pluck
    expect(p.data[1]).toBe(0);
    expect(p.data[200 * 2 + 1]).toBeGreaterThan(0.5); // the bucket at 1.0 s holds the attack
    expect(p.data[200 * 2]).toBeLessThan(-0.5);
  });

  it('mixes channels, so a sound in one channel shows at half height', () => {
    const left = plucks(1, [0.5]);
    const p = computePeaks([left, new Float32Array(left.length)], RATE);
    const mono = computePeaks([left], RATE);
    expect(p.data[100 * 2 + 1]).toBeCloseTo(mono.data[100 * 2 + 1] / 2, 5);
  });

  it('handles empty audio', () => {
    expect(computePeaks([new Float32Array()], RATE)).toMatchObject({ duration: 0 });
    expect(computePeaks([], RATE).data.length).toBe(0);
  });
});

describe('peaksInRange', () => {
  const p = computePeaks([plucks(4, [1, 3])], RATE);

  it('squeezes a time range into pixel columns', () => {
    const cols = peaksInRange(p, 0, 4, 40); // 0.1 s per column
    expect(cols.length).toBe(80);
    expect(cols[5 * 2 + 1]).toBe(0); // 0.5 s: silence
    expect(cols[10 * 2 + 1]).toBeGreaterThan(0.5); // 1.0 s: pluck
    expect(cols[30 * 2 + 1]).toBeGreaterThan(0.5); // 3.0 s: pluck
  });

  it('treats time outside the recording as silence', () => {
    const cols = peaksInRange(p, -2, 6, 8); // 1 s per column
    expect([cols[1], cols[3], cols[15]]).toEqual([0, 0, 0]); // -2 s, -1 s, 5 s
    expect(cols[3 * 2 + 1]).toBeGreaterThan(0.5); // 1 s
  });

  it('still shows something when zoomed in further than a bucket', () => {
    const cols = peaksInRange(p, 1, 1.01, 20); // half a millisecond per column
    expect(Array.from(cols).filter((_, i) => i % 2 === 1).every((v) => v > 0.5)).toBe(true);
  });
});

describe('nearestOnset', () => {
  const p = computePeaks([plucks(4, [1, 1.5, 3])], RATE);

  it('snaps a click near a note to the start of its attack', () => {
    expect(nearestOnset(p, 1.04)).toBeCloseTo(1, 2);
    expect(nearestOnset(p, 0.96)).toBeCloseTo(1, 2);
    expect(nearestOnset(p, 3.06)).toBeCloseTo(3, 2);
  });

  it('picks the nearer of two notes, not the louder or the earlier', () => {
    expect(nearestOnset(p, 1.47, 0.3)).toBeCloseTo(1.5, 2);
  });

  it('leaves a click alone in silence or in the tail of a note', () => {
    expect(nearestOnset(p, 2.3)).toBeNull();
    expect(nearestOnset(p, 1.2)).toBeNull(); // decaying, no new attack within 80 ms
  });

  it('ignores attacks quieter than the threshold (noise)', () => {
    const quiet = computePeaks([plucks(2, [1], 0.02)], RATE);
    expect(nearestOnset(quiet, 1)).toBeNull();
  });

  it('works at the very start and end of the recording', () => {
    const edge = computePeaks([plucks(1, [0.01, 0.9])], RATE);
    expect(nearestOnset(edge, 0)).toBeCloseTo(0.01, 2);
    expect(nearestOnset(edge, 0.97)).toBeCloseTo(0.9, 2);
    // Just after an attack the level is still high: the snap must go back to the attack, not stay late.
    for (const t of [0.905, 0.91, 0.915, 0.92]) expect(nearestOnset(edge, t)).toBeCloseTo(0.9, 3);
  });
});

describe('viewWindow', () => {
  it('centres the window on the playhead', () => {
    expect(viewWindow(10, 4, 60)).toEqual({ from: 8, to: 12 });
  });
  it('stays inside the recording at the start and end', () => {
    expect(viewWindow(0.5, 4, 60)).toEqual({ from: 0, to: 4 });
    expect(viewWindow(59, 4, 60)).toEqual({ from: 56, to: 60 });
  });
  it('starts at 0 when the recording is shorter than the window', () => {
    expect(viewWindow(1, 4, 3)).toEqual({ from: 0, to: 4 });
  });
});
