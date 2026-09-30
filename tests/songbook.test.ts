import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as alphaTab from '@coderline/alphatab';
import {
  QUARTER,
  chordShape,
  fingerSequence,
  fretPitch,
  knownChords,
  parsePitch,
  powerChord,
  splitTicks,
  durationTicks,
  BASS_STANDARD,
} from '../shared/music.ts';
import { parseMelodyBar, songSpecToAlphaTex, type SongSpec } from '../shared/songbook.ts';
import { SONGBOOK } from '../songbook/songs.ts';

function parse(tex: string): alphaTab.model.Score {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  return importer.readScore();
}

/** Playback length of one voice in ticks. */
function voiceTicks(voice: alphaTab.model.Voice): number {
  return voice.beats.reduce((sum, b) => sum + b.playbackDuration, 0);
}

describe('music helpers', () => {
  it('parses pitch names', () => {
    expect(parsePitch('C4')).toBe(60);
    expect(parsePitch('A4')).toBe(69);
    expect(parsePitch('E2')).toBe(40);
    expect(parsePitch('F#3')).toBe(54);
    expect(parsePitch('Bb3')).toBe(58);
    expect(() => parsePitch('H2')).toThrow();
  });

  it('splits lengths into note values', () => {
    expect(splitTicks(QUARTER)).toEqual([{ value: 4, dotted: false }]);
    expect(splitTicks(QUARTER * 3)).toEqual([{ value: 2, dotted: true }]);
    expect(splitTicks(QUARTER * 5)).toEqual([{ value: 1, dotted: false }, { value: 4, dotted: false }]);
    expect(durationTicks(8, false, true)).toBe(QUARTER / 3);
  });

  it('fingers every note at its own pitch', () => {
    const pitches = ['E2', 'A2', 'C4', 'E4', 'G#3', 'B4', 'E5', 'D#5'].map(parsePitch);
    const f = fingerSequence(pitches.map((p) => [p]));
    f.forEach((shape, i) => expect(fretPitch(shape[0])).toBe(pitches[i]));
  });

  it('keeps an open-position melody in open position', () => {
    const f = fingerSequence(['C4', 'D4', 'E4', 'F4', 'G4'].map((n) => [parsePitch(n)]));
    expect(Math.max(...f.map((s) => s[0].fret))).toBeLessThanOrEqual(3);
  });

  it('plays chords on distinct strings within a hand span', () => {
    const [shape] = fingerSequence([['A2', 'E3', 'A3', 'C4', 'E4'].map(parsePitch)]);
    expect(new Set(shape.map((n) => n.string)).size).toBe(5);
    const fretted = shape.filter((n) => n.fret > 0).map((n) => n.fret);
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(4);
  });

  it('uses the bass tuning when asked', () => {
    const [[n]] = fingerSequence([[parsePitch('E1')]], { tuning: BASS_STANDARD });
    expect(n).toEqual({ string: 4, fret: 0 });
  });

  it('has sane chord shapes', () => {
    for (const name of knownChords()) {
      const shape = chordShape(name);
      expect(shape.length, name).toBeGreaterThanOrEqual(3);
      const fretted = shape.filter((n) => n.fret > 0).map((n) => n.fret);
      if (fretted.length) expect(Math.max(...fretted) - Math.min(...fretted), name).toBeLessThanOrEqual(3);
    }
    // C major: C E G on the right strings.
    expect(chordShape('C').map((n) => fretPitch(n) % 12)).toEqual([0, 4, 7, 0, 4]);
    expect(powerChord('A').map((n) => fretPitch(n))).toEqual([45, 52]);
  });
});

describe('songSpecToAlphaTex', () => {
  const tiny: SongSpec = {
    id: 'tiny',
    title: 'Tiny',
    artist: 'Test',
    origin: 'test',
    tempo: 100,
    timeSignature: [3, 4],
    key: 'cmajor',
    pickup: 'G3:4',
    melody: ['C4:2 E4:4', 'G4:2.'],
    chords: ['C', 'C'],
    rhythm: 'waltz',
    drums: 'waltz',
    difficulty: 'beginner',
    tags: [],
  };

  it('writes a pickup bar, four tracks and chord names', () => {
    const score = parse(songSpecToAlphaTex(tiny));
    expect(score.masterBars[0].isAnacrusis).toBe(true);
    expect(score.masterBars).toHaveLength(3);
    expect(score.tracks.map((t) => t.name)).toEqual(['Melody', 'Rhythm guitar', 'Bass', 'Drums']);
    expect(score.masterBars[1].timeSignatureNumerator).toBe(3);
  });

  it('rejects bars of the wrong length', () => {
    expect(() => songSpecToAlphaTex({ ...tiny, melody: ['C4:2', 'G4:2.'] })).toThrow(/melody bar 1/);
  });

  it('rejects unknown chords and mismatched chord bars', () => {
    expect(() => songSpecToAlphaTex({ ...tiny, chords: ['C', 'Xyz'] })).toThrow(/Unknown chord/);
    expect(() => songSpecToAlphaTex({ ...tiny, chords: ['C'] })).toThrow(/chord bars/);
    expect(() => songSpecToAlphaTex({ ...tiny, chords: ['C', 'C G'] })).toThrow(/whole beats/);
  });

  it('applies tempo changes', () => {
    const score = parse(songSpecToAlphaTex({ ...tiny, tempoChanges: { 1: 150 } }));
    expect(score.masterBars[2].tempoAutomations[0]?.value).toBe(150);
  });
});

describe('the bundled songbook', () => {
  it('has at least 20 songs with unique ids', () => {
    expect(SONGBOOK.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SONGBOOK.map((s) => s.id)).size).toBe(SONGBOOK.length);
  });

  for (const spec of SONGBOOK) {
    describe(spec.title, () => {
      const tex = songSpecToAlphaTex(spec);
      const score = parse(tex);

      it('matches the generated file in demo/', () => {
        const onDisk = readFileSync(new URL(`../demo/${spec.id}.atex`, import.meta.url), 'utf8');
        expect(onDisk, 'run npm run build-songbook').toBe(tex);
      });

      it('has full bars in every track', () => {
        for (const track of score.tracks) {
          for (const bar of track.staves[0].bars) {
            const mb = score.masterBars[bar.index];
            const expected = mb.isAnacrusis ? voiceTicks(score.tracks[0].staves[0].bars[0].voices[0]) : mb.calculateDuration();
            expect(voiceTicks(bar.voices[0]), `${track.name} bar ${bar.index + 1}`).toBe(expected);
          }
        }
      });

      it('plays the written melody pitches', () => {
        const written = [...(spec.pickup ? [spec.pickup] : []), ...spec.melody]
          .filter((b) => !b.startsWith('tex:'))
          .flatMap(parseMelodyBar)
          .filter((e) => Array.isArray(e.pitches))
          .map((e) => [...(e.pitches as number[])].sort((a, b) => a - b));
        if (written.length === 0) return; // hand-written fingerstyle tab
        const played = score.tracks[0].staves[0].bars
          .flatMap((b) => b.voices[0].beats)
          .filter((b) => !b.isRest && b.notes.length && !b.notes.every((n) => n.isTieDestination))
          .map((b) => b.notes.map((n) => n.realValue).sort((a, c) => a - c));
        expect(played).toEqual(written);
      });
    });
  }
});
