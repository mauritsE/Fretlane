import { describe, expect, it } from 'vitest';
import { riffCheckProblem, riffFixPrompt, riffProblems, type RiffCheckContext } from '../shared/editor/riffCheck.ts';
import { chordName, chordsText, estimateKey, songHarmony } from '../shared/editor/harmony.ts';
import { buildRiffRequest, riffRequestProblem, songText } from '../shared/editor/assistant.ts';
import { newSongDoc, type DocBeat, type DurationValue } from '../shared/editor/doc.ts';

const GUITAR = [64, 59, 55, 50, 45, 40];
const E_MINOR = { name: 'E minor', pitchClasses: [0, 2, 3, 4, 6, 7, 9, 11] };
const ctx = (over: Partial<RiffCheckContext> = {}): RiffCheckContext => ({
  key: E_MINOR,
  barQuarters: [4, 4],
  tracks: [{ kind: 'guitar', tuning: GUITAR }],
  ...over,
});
const n = (string: number, fret: number, techniques: string[] = []) => ({ string, fret, drum: 'none', techniques });
const d = (...drums: string[]) => drums.map((drum) => ({ string: 0, fret: 0, drum, techniques: [] }));
const beat = (duration: number, notes: unknown[], extra: { dotted?: boolean; triplet?: boolean } = {}) => ({ duration, dotted: false, triplet: false, ...extra, notes });
const eighths = (notes: unknown[][]) => ({ beats: notes.map((x) => beat(8, x)) });
const riff = (...parts: unknown[]) => ({ explanation: 'ok', parts });
const part = (track: number, instrument: string, name: string, bars: unknown[]) => ({ track, instrument, name, bars });
/** Eight eighths on the low E string, frets from E minor: E, G, A, B. */
const goodBar = () => eighths([0, 3, 5, 7, 0, 3, 5, 7].map((f) => [n(6, f)]));

describe('riff checks', () => {
  it('finds nothing wrong with a playable riff in the key that fills its bars', () => {
    expect(riffProblems(riff(part(1, 'guitar', 'Guitar', [goodBar(), goodBar()])), 2, ctx())).toEqual([]);
    // Dotted and triplet notes count right: a dotted quarter + an eighth + three triplet quarters (two beats).
    const mixed = { beats: [beat(4, [n(6, 0)], { dotted: true }), beat(8, [n(6, 3)]), ...[0, 2, 3].map((f) => beat(4, [n(5, f)], { triplet: true }))] };
    expect(riffProblems(riff(part(1, 'guitar', 'Guitar', [mixed, goodBar()])), 2, ctx())).toEqual([]);
  });

  it('finds bars that do not add up and parts with the wrong number of bars', () => {
    const p = riffProblems(riff(part(1, 'guitar', 'Guitar', [eighths([[n(6, 0)], [n(6, 3)]])])), 2, ctx({ barQuarters: [3, 4] }));
    expect(p).toEqual(['Guitar has 1 bar; every part needs exactly 2.', 'Guitar, bar 1 adds up to 1 quarter notes; it needs exactly 3.']);
  });

  it('finds strings the instrument lacks, frets off the neck, two notes on a string and wide stretches', () => {
    const bar = { beats: [beat(4, [n(5, 3)]), beat(4, [n(1, 30)]), beat(4, [n(3, 2), n(3, 5)]), beat(4, [n(4, 2), n(3, 9)])] };
    expect(riffProblems(riff(part(0, 'bass', 'Bass', [bar])), 1, ctx({ barQuarters: [4], key: null }))).toEqual([
      "Bass, bar 1: string 5 doesn't exist on this 4-string bass (1 is the highest string).",
      'Bass, bar 1: frets go from 0 to 24.',
      'Bass, bar 1: two notes on the same string at once; a string plays one note at a time.',
      'Bass, bar 1: a chord from fret 2 to fret 9 is too wide a stretch to play.',
    ]);
    // An existing 7-string track has a string 7; open strings don't count in a stretch.
    const seven = ctx({ key: null, barQuarters: [4], tracks: [{ kind: 'guitar', tuning: [64, 59, 55, 50, 45, 40, 35] }] });
    expect(riffProblems(riff(part(1, 'guitar', 'G', [{ beats: [beat(1, [n(7, 0), n(1, 12), n(2, 0)])] }])), 1, seven)).toEqual([]);
  });

  it('finds drum hits no drummer can play', () => {
    const bar = { beats: [beat(2, d('kick', 'snare', 'crash', 'ride', 'highTom')), beat(4, d('openHiHat', 'closedHiHat')), beat(4, d('snare', 'snare'))] };
    expect(riffProblems(riff(part(0, 'drums', 'Drums', [bar])), 1, ctx({ barQuarters: [4] }))).toEqual([
      'Drums, bar 1: 5 drum hits at once; a drummer can play at most 4.',
      'Drums, bar 1: two hi-hat sounds at once (openHiHat and closedHiHat); the hi-hat is either open or closed.',
      'Drums, bar 1: the same drum twice on one beat.',
    ]);
  });

  it('finds parts that leave the key, but allows passing notes and dead notes', () => {
    // F, F#… mostly chromatic on the low E string: frets 1, 2 (F#, in key), 1, 1, 1, 8 (C, in key), 1, 1.
    const chromatic = eighths([1, 2, 1, 1, 1, 8, 1, 1].map((f) => [n(6, f)]));
    expect(riffProblems(riff(part(1, 'guitar', 'Guitar', [chromatic, goodBar()])), 2, ctx())).toEqual([
      "Guitar: 6 of 16 notes are outside E minor, the song's key. Keep to the key unless the guitarist asked for a change.",
    ]);
    const passing = eighths([0, 1, 3, 5, 7, 0, 3, 5].map((f) => [n(6, f)]));
    expect(riffProblems(riff(part(1, 'guitar', 'Guitar', [passing, goodBar()])), 2, ctx())).toEqual([]);
    const dead = eighths([1, 1, 1, 1, 1, 1, 1, 1].map((f) => [n(6, f, ['dead'])]));
    expect(riffProblems(riff(part(1, 'guitar', 'Guitar', [dead, goodBar()])), 2, ctx())).toEqual([]);
    // Without a key (or a check context, from an older app), only what needs none is checked.
    expect(riffProblems(riff(part(1, 'guitar', 'Guitar', [chromatic, goodBar()])), 2, ctx({ key: null }))).toEqual([]);
    expect(riffProblems(riff(part(1, 'guitar', 'Guitar', [eighths([[n(6, 0)]]), goodBar()])), 2)).toEqual([]);
  });

  it('ignores answers that are not riffs (the app reports those) and caps the list', () => {
    expect(riffProblems(null, 1, ctx())).toEqual([]);
    expect(riffProblems({ parts: 'no' }, 1, ctx())).toEqual([]);
    const many = { beats: Array.from({ length: 20 }, () => beat(16, [n(9, 0)])) };
    expect(riffProblems(riff(part(1, 'guitar', 'G', [many])), 1, ctx({ barQuarters: [4], key: null }))).toHaveLength(12);
  });

  it('asks for the whole answer again with the problems fixed', () => {
    const text = riffFixPrompt(['Guitar, bar 1 adds up to 3 quarter notes; it needs exactly 4.']);
    expect(text).toContain('- Guitar, bar 1 adds up to 3 quarter notes; it needs exactly 4.');
    expect(text).toContain('Send the whole answer again');
  });

  it('checks the context sent with a request', () => {
    expect(riffCheckProblem(ctx(), 2)).toBeNull();
    expect(riffCheckProblem(ctx({ key: null }), 2)).toBeNull();
    expect(riffCheckProblem(ctx({ barQuarters: [4, 4, 4] }), 2)).toMatch(/barQuarters/);
    expect(riffCheckProblem(ctx({ key: { name: 'x', pitchClasses: [12] } }), 2)).toMatch(/key/);
    expect(riffCheckProblem(ctx({ tracks: [{ kind: 'guitar', tuning: [200] }] }), 2)).toMatch(/tracks/);
    expect(riffCheckProblem('nope', 2)).toMatch(/object/);
    const req = { mode: 'generate', prompt: 'x', bars: 2, song: 's', focus: 'f' };
    expect(riffRequestProblem(req)).toBeNull();
    expect(riffRequestProblem({ ...req, check: ctx() })).toBeNull();
    expect(riffRequestProblem({ ...req, check: ctx({ barQuarters: [0] }) })).toMatch(/barQuarters/);
  });
});

describe('harmony estimates', () => {
  const pcs = (...notes: [number, number][]) => {
    const w = Array<number>(12).fill(0);
    for (const [pc, len] of notes) w[pc] += len;
    return w;
  };

  it('finds the key from how long each pitch class sounds', () => {
    // E minor: lots of E, G, B, some A, D, F#.
    const em = pcs([4, 8], [7, 4], [11, 4], [9, 2], [2, 2], [6, 1], [0, 1]);
    expect(estimateKey(em, 20)?.name).toBe('E minor');
    expect(estimateKey(pcs([0, 6], [4, 4], [7, 4], [5, 2], [2, 2], [9, 1], [11, 1]), 20)?.name).toBe('C major');
    expect(estimateKey(em, 20)?.pitchClasses).toEqual([0, 2, 3, 4, 6, 7, 9, 11]);
    expect(estimateKey(em, 5)).toBeNull();
  });

  it('names chords, power chords included, and merges runs of bars', () => {
    expect(chordName(pcs([4, 2], [7, 1], [11, 1]), 4)).toBe('Em');
    expect(chordName(pcs([0, 2], [4, 1], [7, 1]), 0)).toBe('C');
    expect(chordName(pcs([4, 2], [11, 2]), 4)).toBe('E5');
    expect(chordName(Array(12).fill(0), null)).toBeNull();
    expect(chordsText(['Em', 'Em', 'C', null, 'D5'])).toBe('Chords (estimated from the notes): bars 1–2 Em, bar 3 C, bar 5 D5.');
    expect(chordsText([null, null])).toBeNull();
  });

  it('reads a song: key, chords per bar, in the song text and the request', () => {
    // Bar 1: an E minor arpeggio. Bar 2: a C chord. Bar 3: E and B power chords.
    const doc = newSongDoc({ title: 'H', artist: 'Me', tempo: 100, ts: [4, 4], tracks: [{ name: 'Guitar', kind: 'guitar', sound: 'distortionguitar', tuning: GUITAR }], bars: 3 });
    const b = (duration: DurationValue, notes: [number, number][]): DocBeat => ({ duration, notes: notes.map(([string, fret]) => ({ string, fret })) });
    const cChord: [number, number][] = [[5, 3], [4, 2], [3, 0], [2, 1], [1, 0]];
    doc.bars[0].tracks[0] = ([[6, 0], [5, 2], [4, 2], [3, 0], [2, 0], [1, 0], [4, 2], [5, 2]] as [number, number][]).map((x) => b(8, [x]));
    doc.bars[1].tracks[0] = [b(4, cChord), b(4, cChord), b(4, cChord), b(4, cChord)];
    doc.bars[2].tracks[0] = [b(2, [[6, 0], [5, 2]]), b(2, [[6, 0], [5, 2]])];
    const h = songHarmony(doc);
    expect(h.chords).toEqual(['Em', 'C', 'E5']);
    expect(h.key?.name).toMatch(/E minor|G major|C major/);
    const text = songText(doc);
    expect(text).toContain(`Key (estimated from the notes): ${h.key!.name}.`);
    expect(text).toContain('Chords (estimated from the notes): bar 1 Em, bar 2 C, bar 3 E5.');
    const req = buildRiffRequest(doc, 0, { mode: 'generate', at: 3, bars: 2, prompt: 'more' });
    expect(req.check).toEqual({ key: h.key, barQuarters: [4, 4], tracks: [{ kind: 'guitar', tuning: GUITAR }] });
    expect(riffRequestProblem(req)).toBeNull();
  });
});
