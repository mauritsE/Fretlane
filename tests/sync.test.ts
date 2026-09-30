import { describe, expect, it } from 'vitest';
import { bpmBetween, normalizeSyncPoints, shiftSyncPoints, toFlatSyncPoints, upsertSyncPoint } from '../shared/sync.ts';

// 2000 ms per bar
const barStartMs = (bar: number) => bar * 2000;

describe('toFlatSyncPoints', () => {
  it('returns [] for empty input', () => {
    expect(toFlatSyncPoints([], barStartMs)).toEqual([]);
  });
  it('single pin at bar 0', () => {
    expect(toFlatSyncPoints([{ bar: 0, time: 1.5 }], barStartMs)).toEqual([{ barIndex: 0, barPosition: 0, barOccurence: 0, millisecondOffset: 1500 }]);
  });
  it('extrapolates a bar-0 point when the first pin is later', () => {
    const flat = toFlatSyncPoints([{ bar: 2, time: 10 }], barStartMs);
    expect(flat).toEqual([
      { barIndex: 0, barPosition: 0, barOccurence: 0, millisecondOffset: 6000 },
      { barIndex: 2, barPosition: 0, barOccurence: 0, millisecondOffset: 10000 },
    ]);
  });
  it('does not extrapolate when bar 0 is pinned, and sorts', () => {
    const flat = toFlatSyncPoints(
      [
        { bar: 4, time: 9 },
        { bar: 0, time: 1 },
      ],
      barStartMs,
    );
    expect(flat.map((f) => [f.barIndex, f.millisecondOffset])).toEqual([
      [0, 1000],
      [4, 9000],
    ]);
  });
  it('rounds to whole milliseconds', () => {
    expect(toFlatSyncPoints([{ bar: 0, time: 1.23456 }], barStartMs)[0].millisecondOffset).toBe(1235);
  });
});

describe('normalizeSyncPoints', () => {
  it('sorts by bar', () => {
    expect(
      normalizeSyncPoints([
        { bar: 3, time: 9 },
        { bar: 1, time: 3 },
        { bar: 2, time: 6 },
      ]),
    ).toEqual([
      { bar: 1, time: 3 },
      { bar: 2, time: 6 },
      { bar: 3, time: 9 },
    ]);
  });
  it('dedupes with last write winning', () => {
    expect(
      normalizeSyncPoints([
        { bar: 1, time: 3 },
        { bar: 1, time: 4 },
      ]),
    ).toEqual([{ bar: 1, time: 4 }]);
  });
  it('drops pins with non-increasing time', () => {
    expect(
      normalizeSyncPoints([
        { bar: 0, time: 1 },
        { bar: 1, time: 5 },
        { bar: 2, time: 4 },
        { bar: 3, time: 5 },
        { bar: 4, time: 6 },
      ]),
    ).toEqual([
      { bar: 0, time: 1 },
      { bar: 1, time: 5 },
      { bar: 4, time: 6 },
    ]);
  });
  it('drops negative bars and non-finite values, floors fractional bars', () => {
    expect(
      normalizeSyncPoints([
        { bar: -1, time: 1 },
        { bar: NaN, time: 2 },
        { bar: 1, time: Infinity },
        { bar: 2.7, time: 3 },
      ]),
    ).toEqual([{ bar: 2, time: 3 }]);
  });
  it('does not mutate its input', () => {
    const input = [
      { bar: 2, time: 2 },
      { bar: 1, time: 1 },
    ];
    normalizeSyncPoints(input);
    expect(input[0].bar).toBe(2);
  });
});

describe('upsertSyncPoint', () => {
  it('inserts in order', () => {
    expect(upsertSyncPoint([{ bar: 0, time: 1 }, { bar: 4, time: 9 }], 2, 5)).toEqual([
      { bar: 0, time: 1 },
      { bar: 2, time: 5 },
      { bar: 4, time: 9 },
    ]);
  });
  it('replaces an existing bar', () => {
    expect(upsertSyncPoint([{ bar: 0, time: 1 }, { bar: 2, time: 5 }], 2, 6)).toEqual([
      { bar: 0, time: 1 },
      { bar: 2, time: 6 },
    ]);
  });
  it('works on empty list', () => {
    expect(upsertSyncPoint([], 0, 0)).toEqual([{ bar: 0, time: 0 }]);
  });
});

describe('shiftSyncPoints', () => {
  it('shifts later and earlier', () => {
    expect(shiftSyncPoints([{ bar: 0, time: 1 }, { bar: 1, time: 2.5 }], 0.5)).toEqual([
      { bar: 0, time: 1.5 },
      { bar: 1, time: 3 },
    ]);
    expect(shiftSyncPoints([{ bar: 1, time: 2.5 }], -1)).toEqual([{ bar: 1, time: 1.5 }]);
  });
  it('clamps at 0', () => {
    expect(shiftSyncPoints([{ bar: 0, time: 0.2 }, { bar: 1, time: 3 }], -1)).toEqual([
      { bar: 0, time: 0 },
      { bar: 1, time: 2 },
    ]);
  });
  it('avoids float noise', () => {
    expect(shiftSyncPoints([{ bar: 0, time: 0.1 }], 0.2)[0].time).toBe(0.3);
  });
});

describe('bpmBetween', () => {
  it('computes bpm', () => {
    expect(bpmBetween({ bar: 0, time: 0 }, { bar: 1, time: 2 }, 4)).toBe(120);
    expect(bpmBetween({ bar: 0, time: 1 }, { bar: 2, time: 5 }, 8)).toBe(120);
  });
  it('returns 0 for non-positive time span', () => {
    expect(bpmBetween({ bar: 0, time: 2 }, { bar: 1, time: 2 }, 4)).toBe(0);
    expect(bpmBetween({ bar: 0, time: 3 }, { bar: 1, time: 2 }, 4)).toBe(0);
  });
});
