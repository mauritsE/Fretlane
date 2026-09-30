import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { asciiTabToAlphaTex, findTabBlocks, resolveTuning, tokenizeBlock } from '../shared/asciiTab.ts';

const STD = ['e|--0---3--|--5--|', 'B|--1---0--|-----|', 'G|--0---0--|-----|', 'D|--2---0--|-----|', 'A|--3---2--|-----|', 'E|------3--|-----|'].join('\n');

function block(lines: string[], names?: string[]) {
  return { names: names ?? lines.map(() => ''), lines };
}

describe('findTabBlocks', () => {
  it('finds a single 6 line block with names and bodies', () => {
    const blocks = findTabBlocks(STD);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].names).toEqual(['e', 'B', 'G', 'D', 'A', 'E']);
    expect(blocks[0].lines[0]).toBe('|--0---3--|--5--|');
    expect(blocks[0].lines).toHaveLength(6);
  });
  it('finds several blocks separated by text', () => {
    const text = `Verse\n${STD}\n\nChorus\n${STD}\n`;
    expect(findTabBlocks(text)).toHaveLength(2);
  });
  it('handles CRLF and tabs', () => {
    expect(findTabBlocks(STD.replace(/\n/g, '\r\n'))).toHaveLength(1);
  });
  it('accepts 4 string bass', () => {
    const bass = ['G|----0----|', 'D|--0------|', 'A|-3--------|', 'E|-------3--|'].join('\n');
    expect(findTabBlocks(bass)[0].lines).toHaveLength(4);
  });
  it('ignores groups with fewer than 4 or more than 7 lines', () => {
    expect(findTabBlocks(STD.split('\n').slice(0, 3).join('\n'))).toEqual([]);
    const eight = Array(8).fill('e|--0--3--|').join('\n');
    expect(findTabBlocks(eight)).toEqual([]);
  });
  it('returns [] for non tab text', () => {
    expect(findTabBlocks('hello\nworld')).toEqual([]);
  });
});

describe('tokenizeBlock', () => {
  it('emits single notes and bar lines', () => {
    const t = tokenizeBlock(block(['|--0--|', '|-----|', '|-----|', '|-----|', '|-----|', '|--3--|']));
    expect(t).toEqual([
      { kind: 'bar' },
      { kind: 'beat', notes: [{ string: 1, fret: 0, effects: [] }, { string: 6, fret: 3, effects: [] }] },
      { kind: 'bar' },
    ]);
  });
  it('splits notes on different columns into separate beats', () => {
    const t = tokenizeBlock(block(['|0-2|', '|---|', '|---|', '|---|']));
    const beats = t.filter((x) => x.kind === 'beat');
    expect(beats).toHaveLength(2);
  });
  it('groups chords in the same column', () => {
    const t = tokenizeBlock(block(['|-0-|', '|-1-|', '|-0-|', '|-2-|', '|-3-|', '|---|']));
    const beat = t.find((x) => x.kind === 'beat') as Extract<(typeof t)[number], { kind: 'beat' }>;
    expect(beat.notes.map((n) => [n.string, n.fret])).toEqual([
      [1, 0],
      [2, 1],
      [3, 0],
      [4, 2],
      [5, 3],
    ]);
  });
  it('reads two-digit frets', () => {
    const t = tokenizeBlock(block(['|-12-|', '|----|', '|----|', '|----|']));
    const beat = t.find((x) => x.kind === 'beat') as any;
    expect(beat.notes).toEqual([{ string: 1, fret: 12, effects: [] }]);
    expect(t.filter((x) => x.kind === 'beat')).toHaveLength(1);
  });
  it('two-digit fret alongside a single digit on another string in the same column', () => {
    const t = tokenizeBlock(block(['|-12-|', '|-3--|', '|----|', '|----|']));
    const beat = t.find((x) => x.kind === 'beat') as any;
    expect(beat.notes.map((n: any) => [n.string, n.fret])).toEqual([
      [1, 12],
      [2, 3],
    ]);
    expect(t.filter((x) => x.kind === 'beat')).toHaveLength(1);
  });
  it('detects hammer-on / pull-off / slide / vibrato effects', () => {
    const t = tokenizeBlock(block(['|-3h5-|', '|-2/4-|', '|-1p0-|', '|-7~--|']));
    const beats = t.filter((x) => x.kind === 'beat') as any[];
    // Each string's first fret shares column 1; effect is looked up on the following character.
    const first = beats[0].notes;
    expect(first.find((n: any) => n.string === 1).effects).toEqual(['h']);
    expect(first.find((n: any) => n.string === 2).effects).toEqual(['sl']);
    expect(first.find((n: any) => n.string === 3).effects).toEqual(['h']);
    expect(first.find((n: any) => n.string === 4).effects).toEqual(['v']);
  });
  it('reads dead notes', () => {
    const t = tokenizeBlock(block(['|-x-|', '|---|', '|---|', '|---|']));
    const beat = t.find((x) => x.kind === 'beat') as any;
    expect(beat.notes).toEqual([{ string: 1, fret: 'x', effects: [] }]);
  });
  it('emits a bar token per bar line', () => {
    const t = tokenizeBlock(block(['|-0-|-1-|', '|---|---|', '|---|---|', '|---|---|']));
    expect(t.map((x) => x.kind)).toEqual(['bar', 'beat', 'bar', 'beat', 'bar']);
  });
  it('does not treat repeat colons as notes', () => {
    const t = tokenizeBlock(block(['|:-0-:|', '|:---:|', '|:---:|', '|:---:|']));
    expect(t.filter((x) => x.kind === 'beat')).toHaveLength(1);
  });
});

describe('resolveTuning', () => {
  it('standard tuning', () => {
    expect(resolveTuning(['e', 'B', 'G', 'D', 'A', 'E'], 6)).toEqual(['e4', 'b3', 'g3', 'd3', 'a2', 'e2']);
  });
  it('drop D given top-to-bottom e,B,G,D,A,D', () => {
    expect(resolveTuning(['e', 'B', 'G', 'D', 'A', 'D'], 6)).toEqual(['e4', 'b3', 'g3', 'd3', 'a2', 'd2']);
  });
  it('drop D written as D A D G B E (low to high) is still descending-assigned by position', () => {
    // Names are interpreted top-to-bottom, so a bottom-up listing yields a descending but different tuning.
    const r = resolveTuning(['D', 'A', 'D', 'G', 'B', 'E'], 6);
    expect(r).toHaveLength(6);
  });
  it('4 string bass', () => {
    expect(resolveTuning(['G', 'D', 'A', 'E'], 4)).toEqual(['g2', 'd2', 'a1', 'e1']);
  });
  it('flats become sharps', () => {
    expect(resolveTuning(['Eb', 'Bb', 'Gb', 'Db', 'Ab', 'Db'], 6)).toEqual(['d#4', 'a#3', 'f#3', 'c#3', 'g#2', 'c#2']);
  });
  it('produces strictly descending pitches', () => {
    const r = resolveTuning(['E', 'B', 'G', 'D', 'A', 'E'], 6);
    expect(r).toEqual(['e4', 'b3', 'g3', 'd3', 'a2', 'e2']);
  });
  it('falls back on invalid names', () => {
    const std = ['e4', 'b3', 'g3', 'd3', 'a2', 'e2'];
    expect(resolveTuning(['e', 'B', 'G', 'D', 'A', 'Q'], 6)).toEqual(std);
    expect(resolveTuning(['e', 'B', 'G', 'D', 'A', 'H'], 6)).toEqual(std);
  });
  it('falls back on missing names or wrong count', () => {
    const std = ['e4', 'b3', 'g3', 'd3', 'a2', 'e2'];
    expect(resolveTuning(['', '', '', '', '', ''], 6)).toEqual(std);
    expect(resolveTuning(['e', 'B'], 6)).toEqual(std);
    expect(resolveTuning(['', '', '', ''], 4)).toEqual(['g2', 'd2', 'a1', 'e1']);
  });
  it('falls back to 6-string default for unusual string counts', () => {
    expect(resolveTuning([], 3)).toEqual(['e4', 'b3', 'g3', 'd3', 'a2', 'e2']);
  });
});

describe('asciiTabToAlphaTex', () => {
  it('throws when there is no tab', () => {
    expect(() => asciiTabToAlphaTex('just some lyrics')).toThrow(/No ASCII tab/);
  });
  it('contains header, tuning and bar separators', () => {
    const tex = asciiTabToAlphaTex(STD, { title: 'My "Song"', artist: 'Me', tempo: 90 });
    expect(tex).toContain("\\title \"My 'Song'\"");
    expect(tex).toContain('\\artist "Me"');
    expect(tex).toContain('\\tempo 90');
    expect(tex).toContain('\\tuning (e4 b3 g3 d3 a2 e2)');
    expect(tex).toContain('\\instrument distortionguitar');
    expect(tex).toMatch(/ \|\n/);
    expect(tex).toContain(':8 ');
  });
  it('honours duration and uses bass instrument for 4 strings', () => {
    const bass = ['G|-0---|', 'D|---2-|', 'A|-----|', 'E|-----|'].join('\n');
    const tex = asciiTabToAlphaTex(bass, { duration: 16 });
    expect(tex).toContain(':16 ');
    expect(tex).toContain('\\instrument electricbassfinger');
    expect(tex).toContain('\\tuning (g2 d2 a1 e1)');
  });
  it('throws when staves have no notes', () => {
    const empty = Array(6).fill('|------|').join('\n');
    expect(() => asciiTabToAlphaTex(empty)).toThrow(/no notes/);
  });
  // BUG (source): six identical string names (e.g. "e|" on every line) make resolveTuning walk below
  // octave 0, so NOTE_ORDER[negative] is undefined and a TypeError leaks instead of a fallback tuning.
  it('identical string names on 6 lines fall back to the default tuning instead of crashing', () => {
    expect(resolveTuning(['e', 'e', 'e', 'e', 'e', 'e'], 6)).toEqual(['e4', 'b3', 'g3', 'd3', 'a2', 'e2']);
  });

  describe('parses with alphaTab', () => {
    function parse(tex: string) {
      const imp = new alphaTab.importer.AlphaTexImporter();
      imp.initFromString(tex, new alphaTab.Settings());
      return imp.readScore();
    }

    it('round-trips bars, frets and pitch order', () => {
      const tex = asciiTabToAlphaTex(STD, { title: 'T', artist: 'A' });
      const score = parse(tex);
      expect(score.title).toBe('T');
      expect(score.masterBars.length).toBe(2);
      const bar0 = score.tracks[0].staves[0].bars[0].voices[0].beats;
      // First column is a chord: e=0, B=1, G=0, D=2, A=3
      const notes = bar0[0].notes;
      expect(notes).toHaveLength(5);
      const byFret = [...notes].sort((a, b) => b.realValue - a.realValue);
      // Highest sounding note is open high e (E4 = 64), lowest is A string fret 3 (C3 = 48)
      expect(byFret[0].realValue).toBe(64);
      expect(byFret[0].fret).toBe(0);
      expect(byFret[byFret.length - 1].realValue).toBe(48);
      expect(byFret[byFret.length - 1].fret).toBe(3);
    });

    it('a note on the high e line sounds higher than the same fret on the low E line', () => {
      const tab = ['e|--3--|', 'B|-----|', 'G|-----|', 'D|-----|', 'A|-----|', 'E|--3--|'].join('\n');
      // Put them in separate columns so they are separate beats.
      const tab2 = ['e|-3---|', 'B|-----|', 'G|-----|', 'D|-----|', 'A|-----|', 'E|---3-|'].join('\n');
      void tab;
      const score = parse(asciiTabToAlphaTex(tab2));
      const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
      expect(beats).toHaveLength(2);
      const high = beats[0].notes[0];
      const low = beats[1].notes[0];
      expect(high.fret).toBe(3);
      expect(low.fret).toBe(3);
      expect(high.realValue).toBe(67); // G4
      expect(low.realValue).toBe(43); // G2
      expect(high.realValue).toBeGreaterThan(low.realValue);
    });

    it('drop D tuning makes the low string sound a whole step lower', () => {
      const tab = ['e|-0---|', 'B|-----|', 'G|-----|', 'D|-----|', 'A|-----|', 'D|---0-|'].join('\n');
      const score = parse(asciiTabToAlphaTex(tab));
      const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
      expect(beats[0].notes[0].realValue).toBe(64);
      expect(beats[1].notes[0].realValue).toBe(38); // D2
    });

    it('preserves hammer-on, dead note and two-digit frets', () => {
      const tab = ['e|-3h5-12--x-|', 'B|-----------|', 'G|-----------|', 'D|-----------|', 'A|-----------|', 'E|-----------|'].join('\n');
      const score = parse(asciiTabToAlphaTex(tab));
      const notes = score.tracks[0].staves[0].bars[0].voices[0].beats.flatMap((b) => b.notes);
      expect(notes.map((n) => n.fret)).toEqual([3, 5, 12, 0]);
      expect(notes[0].isHammerPullOrigin).toBe(true);
      expect(notes[3].isDead).toBe(true);
    });

    it('bass tab parses with 4 strings', () => {
      const bass = ['G|-0---|', 'D|---2-|', 'A|-----|', 'E|-----|'].join('\n');
      const score = parse(asciiTabToAlphaTex(bass));
      expect(score.tracks[0].staves[0].tuning).toHaveLength(4);
      const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
      expect(beats[0].notes[0].realValue).toBe(43); // open G2
      expect(beats[1].notes[0].realValue).toBe(38 + 2 - 0); // D2 + 2 = E2 (40)
    });

    it('multiple blocks concatenate bars', () => {
      const score = parse(asciiTabToAlphaTex(`${STD}\n\n${STD}`));
      expect(score.masterBars.length).toBe(4);
    });
  });
});
