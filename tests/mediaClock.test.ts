import { describe, expect, it } from 'vitest';
import { MediaClock } from '../shared/mediaClock.ts';

describe('MediaClock', () => {
  it('holds still while paused', () => {
    const c = new MediaClock(200);
    c.report(12.5, false, 1000);
    expect(c.read(1000)).toBe(12.5);
    expect(c.read(9000)).toBe(12.5);
  });

  it('extrapolates between reports while playing', () => {
    const c = new MediaClock(200);
    c.report(10, true, 1000);
    expect(c.read(1250)).toBeCloseTo(10.25, 6);
    expect(c.read(1500)).toBeCloseTo(10.5, 6);
    // a new report replaces the estimate
    c.report(10.48, true, 1500);
    expect(c.read(1600)).toBeCloseTo(10.58, 6);
  });

  it('never runs past the end or before the last report', () => {
    const c = new MediaClock();
    c.report(199, true, 0, 200);
    expect(c.read(5000)).toBe(200);
    expect(c.read(-100)).toBe(199); // a wall clock reading older than the report does not go back
  });

  it('set() jumps immediately and keeps the play state', () => {
    const c = new MediaClock(200);
    c.report(50, true, 0);
    c.set(5, 1000);
    expect(c.isPlaying).toBe(true);
    expect(c.read(1100)).toBeCloseTo(5.1, 6);
    c.report(5.1, false, 1100);
    c.set(30, 2000);
    expect(c.read(9000)).toBe(30);
  });

  it('keeps the last known duration when a report has none', () => {
    const c = new MediaClock();
    c.report(0, false, 0, 180);
    c.report(1, false, 10, 0);
    expect(c.length).toBe(180);
  });
});
