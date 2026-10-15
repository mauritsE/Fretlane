import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as alphaTab from '@coderline/alphatab';
import {
  TUNING_PRESETS,
  barStatus,
  barTicks,
  beatTicks,
  describeTicks,
  newSongDoc,
  parseTuning,
  pitchName,
  restsFor,
  voiceTicks,
  type DocTrack,
  type SongDoc,
} from '../shared/editor/doc.ts';
import { docToTex } from '../shared/editor/tex.ts';
import { scoreToDoc } from '../shared/editor/fromScore.ts';
import {
  History,
  addTrack,
  clampCursor,
  copyBars,
  cycleRepeatEnd,
  deleteAtCursor,
  deleteBars,
  deleteBeat,
  insertBar,
  insertBeat,
  makeRest,
  moveBeat,
  moveString,
  pasteBars,
  removeTrack,
  setBarTempo,
  setDuration,
  setSection,
  setTimeSignature,
  toggleDotted,
  toggleNoteFlag,
  toggleRepeatStart,
  toggleTriplet,
  typeFret,
  updateTrack,
  type Cursor,
  type Edit,
  type Entry,
} from '../shared/editor/commands.ts';

const GUITAR: DocTrack = { name: 'Guitar', kind: 'guitar', sound: 'electricguitarclean', tuning: TUNING_PRESETS[0].tuning };
const BASS: DocTrack = { name: 'Bass', kind: 'bass', sound: 'electricbassfinger', tuning: TUNING_PRESETS.find((p) => p.id === 'bass-standard')!.tuning };
const EIGHTH: Entry = { duration: 8 };
const START: Cursor = { track: 0, bar: 0, beat: 0, string: 6 };

function song(tracks: DocTrack[] = [GUITAR], bars = 2, ts: [number, number] = [4, 4]): SongDoc {
  return newSongDoc({ title: 'Test "Riff"', artist: 'Me', tempo: 100, ts, tracks, bars });
}

function parse(tex: string): alphaTab.model.Score {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  return importer.readScore();
}

/** Runs edits one after another, feeding each result's document and cursor into the next. */
function run(doc: SongDoc, cursor: Cursor, ...steps: ((d: SongDoc, c: Cursor) => Edit)[]): Edit {
  let e: Edit = { doc, cursor, changedBar: -1 };
  for (const step of steps) e = step(e.doc, e.cursor);
  return e;
}

/** Bars as "fret.string:duration" lists, rests as "r:duration", for readable assertions. */
function show(doc: SongDoc, track = 0): string[] {
  return doc.bars.map((b) =>
    b.tracks[track]
      .map((beat) => {
        const len = `${beat.duration}${beat.dotted ? '.' : ''}${beat.triplet ? 't' : ''}`;
        return beat.notes.length ? `${beat.notes.map((n) => `${n.fret}.${n.string}`).join('+')}:${len}` : `r:${len}`;
      })
      .join(' '),
  );
}

describe('editor document', () => {
  it('measures beats and bars in ticks', () => {
    expect(beatTicks({ duration: 4 })).toBe(960);
    expect(beatTicks({ duration: 8, dotted: true })).toBe(720);
    expect(beatTicks({ duration: 8, triplet: true })).toBe(320);
    expect(barTicks([4, 4])).toBe(3840);
    expect(barTicks([6, 8])).toBe(2880);
    expect(barTicks([7, 8])).toBe(3360);
  });

  it('fills a length with as few rests as possible', () => {
    expect(restsFor(3840)).toEqual([{ duration: 1, notes: [] }]);
    expect(restsFor(2880)).toEqual([{ duration: 2, dotted: true, notes: [] }]);
    expect(restsFor(3360).map((r) => beatTicks(r))).toEqual([2880, 480]);
    expect(voiceTicks(restsFor(3520))).toBe(3520);
  });

  it('describes how far off a bar is', () => {
    expect(describeTicks(480)).toBe('an eighth');
    expect(describeTicks(-960)).toBe('a quarter');
    expect(describeTicks(1440)).toBe('a dotted quarter');
    expect(describeTicks(720)).toBe('a dotted eighth');
    expect(describeTicks(320)).toBe('320 ticks');
  });

  it('starts a new song with full bars of rests', () => {
    const doc = song([GUITAR, BASS], 4, [3, 4]);
    expect(doc.bars).toHaveLength(4);
    expect(show(doc, 1)[0]).toBe('r:2.');
    expect(barStatus(doc, 0, 0).diff).toBe(0);
  });

  it('parses custom tunings, lowest string first', () => {
    expect(parseTuning('D A D G B E', 'guitar')).toEqual([64, 59, 55, 50, 45, 38]);
    expect(parseTuning('E A D G B E', 'guitar')).toEqual(TUNING_PRESETS[0].tuning);
    expect(parseTuning('B1 E2 A2 D3 G3', 'bass')).toEqual([55, 50, 45, 40, 35]);
    expect(parseTuning('E A D G', 'bass')).toEqual([43, 38, 33, 28]);
    expect(parseTuning('C# F# B E G# C#', 'guitar')).toEqual([61, 56, 52, 47, 42, 37]);
    expect(parseTuning('E A D', 'guitar')).toBeNull();
    expect(parseTuning('E A D G B H', 'guitar')).toBeNull();
    expect(pitchName(40)).toBe('E2');
    expect(pitchName(63)).toBe('Eb4');
  });
});

describe('editor commands', () => {
  it('types a riff: a rest becomes a note and the rest of the bar stays full', () => {
    const e = run(
      song(),
      START,
      (d, c) => typeFret(d, c, 3, EIGHTH),
      (d, c) => moveBeat(d, c, 1),
      (d, c) => typeFret(d, c, 5, EIGHTH),
    );
    expect(show(e.doc)[0]).toBe('3.6:8 5.6:8 r:2.');
    expect(barStatus(e.doc, 0, 0).diff).toBe(0);
    expect(e.changedBar).toBe(0);
  });

  it('retyping a fret on a note keeps its duration and techniques but clears tie/dead', () => {
    let e = run(song(), START, (d, c) => typeFret(d, c, 7, EIGHTH), (d, c) => toggleNoteFlag(d, c, 'vibrato'), (d, c) => toggleNoteFlag(d, c, 'dead'));
    e = typeFret(e.doc, e.cursor, 9, { duration: 4 });
    const note = e.doc.bars[0].tracks[0][0].notes[0];
    expect(note).toEqual({ string: 6, fret: 9, vibrato: true });
    expect(e.doc.bars[0].tracks[0][0].duration).toBe(8);
  });

  it('builds chords by typing on other strings of the same beat', () => {
    const e = run(song(), START, (d, c) => typeFret(d, c, 0, EIGHTH), (d, c) => moveString(d, c, -1), (d, c) => typeFret(d, c, 2, EIGHTH));
    expect(show(e.doc)[0]).toBe('2.5+0.6:8 r:2. r:8');
  });

  it('rejects impossible frets', () => {
    const e = typeFret(song(), START, 31, EIGHTH);
    expect(e.changedBar).toBe(-1);
    expect(e.message).toMatch(/0 to 30/);
  });

  it('moves between beats and bars, and adds a bar past the end', () => {
    const doc = song(undefined, 1);
    let e = moveBeat(doc, START, 1);
    expect(e.cursor.bar).toBe(1);
    expect(e.doc.bars).toHaveLength(2);
    expect(e.changedBar).toBe(1);
    e = moveBeat(e.doc, e.cursor, -1);
    expect(e.cursor).toMatchObject({ bar: 0, beat: 0 });
    expect(moveBeat(e.doc, e.cursor, -1).cursor).toMatchObject({ bar: 0, beat: 0 });
  });

  it('keeps the cursor on existing strings', () => {
    expect(moveString(song(), { ...START, string: 1 }, -1).cursor.string).toBe(1);
    expect(moveString(song(), START, 1).cursor.string).toBe(6);
    expect(clampCursor(song([BASS]), { track: 3, bar: 9, beat: 9, string: 6 })).toEqual({ track: 0, bar: 1, beat: 0, string: 4 });
  });

  it('longer notes eat the rests after them; shorter ones leave a rest', () => {
    let e = run(song(), START, (d, c) => typeFret(d, c, 3, EIGHTH), (d, c) => moveBeat(d, c, 1), (d, c) => typeFret(d, c, 5, EIGHTH));
    // The 5 moves along; the room comes from the rest after it.
    e = setDuration(e.doc, { ...e.cursor, beat: 0 }, 4);
    expect(show(e.doc)[0]).toBe('3.6:4 5.6:8 r:2 r:8');
    e = setDuration(e.doc, { ...e.cursor, beat: 0 }, 2);
    expect(show(e.doc)[0]).toBe('3.6:2 5.6:8 r:4.');
    // Not enough rests left: the bar overflows rather than lose the 5, and is flagged.
    e = setDuration(e.doc, { ...e.cursor, beat: 0 }, 1);
    expect(show(e.doc)[0]).toBe('3.6:1 5.6:8');
    expect(barStatus(e.doc, 0, 0).diff).toBe(480);
    // Shorter again: a rest fills in right after the note, so the 5 keeps its place in time.
    e = setDuration(e.doc, { ...e.cursor, beat: 0 }, 16);
    expect(show(e.doc)[0]).toBe('3.6:16 r:2. r:16 5.6:8');
    expect(barStatus(e.doc, 0, 0).diff).toBe(0);
  });

  it('dots and triplets change length and keep the bar full when rests allow', () => {
    let e = run(song(), START, (d, c) => typeFret(d, c, 3, { duration: 4 }), (d, c) => toggleDotted(d, c));
    expect(show(e.doc)[0]).toBe('3.6:4. r:2 r:8');
    expect(barStatus(e.doc, 0, 0).diff).toBe(0);
    e = toggleDotted(e.doc, e.cursor);
    expect(barStatus(e.doc, 0, 0).diff).toBe(0);
    e = toggleTriplet(e.doc, e.cursor);
    expect(e.doc.bars[0].tracks[0][0].triplet).toBe(true);
    expect(barStatus(e.doc, 0, 0).diff).toBe(0);
  });

  it('Delete removes the note on the string, then the beat', () => {
    let e = run(song(), START, (d, c) => typeFret(d, c, 3, EIGHTH), (d, c) => moveString(d, c, -1), (d, c) => typeFret(d, c, 5, EIGHTH));
    e = deleteAtCursor(e.doc, e.cursor);
    expect(show(e.doc)[0]).toBe('3.6:8 r:2. r:8');
    e = deleteAtCursor(e.doc, e.cursor); // string 5 is empty now: the whole beat goes
    expect(show(e.doc)[0]).toBe('r:1');
    expect(barStatus(e.doc, 0, 0).diff).toBe(0);
  });

  it('will not delete the only rest of an empty bar', () => {
    const e = deleteBeat(song(), START);
    expect(e.changedBar).toBe(-1);
    expect(e.message).toMatch(/empty/);
  });

  it('inserting a beat pushes notes right and takes room from rests at the end', () => {
    let e = run(song(), START, (d, c) => typeFret(d, c, 3, EIGHTH));
    e = insertBeat(e.doc, e.cursor, EIGHTH);
    expect(show(e.doc)[0]).toBe('r:8 3.6:8 r:2.');
    expect(barStatus(e.doc, 0, 0).diff).toBe(0);
  });

  it('turns a note beat into a rest', () => {
    const e = run(song(), START, (d, c) => typeFret(d, c, 3, EIGHTH), (d, c) => makeRest(d, c));
    expect(show(e.doc)[0]).toBe('r:8 r:2. r:8');
  });

  it('toggles techniques on the note under the cursor', () => {
    let e = run(song(), START, (d, c) => typeFret(d, c, 5, EIGHTH), (d, c) => toggleNoteFlag(d, c, 'hammer'), (d, c) => toggleNoteFlag(d, c, 'palmMute'));
    expect(e.doc.bars[0].tracks[0][0].notes[0]).toEqual({ string: 6, fret: 5, hammer: true, palmMute: true });
    e = toggleNoteFlag(e.doc, e.cursor, 'hammer');
    expect(e.doc.bars[0].tracks[0][0].notes[0]).toEqual({ string: 6, fret: 5, palmMute: true });
    expect(toggleNoteFlag(e.doc, { ...e.cursor, string: 1 }, 'vibrato').message).toMatch(/note on this string/);
  });

  it('ties copy the fret of the previous note on that string, across a bar line too', () => {
    let e = run(song(), { ...START, bar: 0, beat: 0 }, (d, c) => typeFret(d, c, 7, { duration: 1 }));
    e = typeFret(e.doc, { ...START, bar: 1 }, 0, EIGHTH);
    e = toggleNoteFlag(e.doc, e.cursor, 'tie');
    expect(e.doc.bars[1].tracks[0][0].notes[0]).toEqual({ string: 6, fret: 7, tie: true });
    expect(toggleNoteFlag(song(), START, 'tie').message).toBeTruthy();
    const lonely = typeFret(song(), START, 3, EIGHTH);
    expect(toggleNoteFlag(lonely.doc, lonely.cursor, 'tie').message).toMatch(/same string/);
  });

  it('inserts, deletes, copies and pastes bars across all tracks', () => {
    let e = run(song([GUITAR, BASS], 2), START, (d, c) => typeFret(d, c, 3, EIGHTH));
    e = insertBar(e.doc, e.cursor);
    expect(e.doc.bars).toHaveLength(3);
    expect(e.cursor.bar).toBe(1);
    const clip = copyBars(e.doc, { from: 0, to: 0 });
    e = pasteBars(e.doc, { ...e.cursor, bar: 2 }, clip);
    expect(e.doc.bars).toHaveLength(4);
    expect(show(e.doc)[3]).toBe('3.6:8 r:2. r:8');
    expect(e.doc.bars[3].tracks).toHaveLength(2);
    // The clipboard is a copy: editing the pasted bar leaves the original alone.
    e = typeFret(e.doc, { ...START, bar: 3 }, 9, EIGHTH);
    expect(show(e.doc)[0]).toBe('3.6:8 r:2. r:8');
    e = deleteBars(e.doc, e.cursor, { from: 3, to: 1 });
    expect(e.doc.bars).toHaveLength(1);
    e = deleteBars(e.doc, e.cursor, { from: 0, to: 0 });
    expect(e.doc.bars).toHaveLength(1);
    expect(show(e.doc)[0]).toBe('r:1');
  });

  it('pasting bars copied before a track was added gives the new track rests', () => {
    const doc = song([GUITAR], 1);
    const clip = copyBars(doc, { from: 0, to: 0 });
    const two = addTrack(doc, START, BASS).doc;
    const e = pasteBars(two, START, clip);
    expect(e.doc.bars[1].tracks).toHaveLength(2);
    expect(show(e.doc, 1)[1]).toBe('r:1');
  });

  it('sets repeats, sections and tempo changes', () => {
    let e = run(song(), START, (d, c) => toggleRepeatStart(d, c), (d, c) => setSection(d, c, '  Verse '));
    e = cycleRepeatEnd(e.doc, { ...e.cursor, bar: 1 });
    e = cycleRepeatEnd(e.doc, e.cursor);
    expect(e.doc.bars[0]).toMatchObject({ repeatStart: true, section: 'Verse' });
    expect(e.doc.bars[1].repeatEnd).toBe(3);
    e = setBarTempo(e.doc, e.cursor, 140);
    expect(e.doc.bars[1].tempo).toBe(140);
    e = setBarTempo(e.doc, { ...e.cursor, bar: 0 }, 90);
    expect(e.doc.tempo).toBe(90);
    e = setSection(e.doc, { ...e.cursor, bar: 0 }, '');
    expect(e.doc.bars[0].section).toBeUndefined();
    e = cycleRepeatEnd(cycleRepeatEnd(e.doc, { ...e.cursor, bar: 1 }).doc, { ...e.cursor, bar: 1 });
    expect(e.doc.bars[1].repeatEnd).toBeUndefined();
  });

  it('changes the time signature up to the next change and refits the bars', () => {
    let doc = song(undefined, 4);
    doc = setTimeSignature(doc, { ...START, bar: 3 }, [6, 8]).doc;
    const e = setTimeSignature(doc, START, [3, 4]);
    expect(e.doc.bars.map((b) => b.ts.join('/'))).toEqual(['3/4', '3/4', '3/4', '6/8']);
    for (let i = 0; i < 4; i++) expect(barStatus(e.doc, 0, i).diff).toBe(0);
    expect(setTimeSignature(e.doc, START, [3, 4]).changedBar).toBe(-1);
  });

  it('adds, removes and retunes tracks', () => {
    let e = addTrack(song(), START, BASS);
    expect(e.doc.tracks).toHaveLength(2);
    expect(e.cursor.track).toBe(1);
    expect(e.doc.bars.every((b) => b.tracks.length === 2)).toBe(true);
    e = removeTrack(e.doc, e.cursor, 0);
    expect(e.doc.tracks.map((t) => t.name)).toEqual(['Bass']);
    expect(removeTrack(e.doc, e.cursor, 0).message).toMatch(/at least one/);

    // Retune a guitar to a 4-string tuning: notes on strings 5 and 6 can't stay.
    let g = run(song(), START, (d, c) => typeFret(d, c, 3, EIGHTH), (d, c) => moveString(d, c, -1), (d, c) => typeFret(d, c, 2, EIGHTH), (d, c) => moveString(d, c, -1), (d, c) => typeFret(d, c, 0, EIGHTH));
    g = updateTrack(g.doc, g.cursor, 0, { tuning: [43, 38, 33, 28], name: ' Low ' });
    expect(g.message).toMatch(/2 notes/);
    expect(show(g.doc)[0]).toBe('0.4:8 r:2. r:8');
    expect(g.doc.tracks[0].name).toBe('Low');
    expect(g.cursor.string).toBe(4);
  });

  it('undo and redo walk through earlier documents', () => {
    const h = new History();
    let state = { doc: song(), cursor: START };
    const apply = (e: Edit) => {
      if (e.changedBar >= 0) h.push(state);
      state = { doc: e.doc, cursor: e.cursor };
    };
    apply(typeFret(state.doc, state.cursor, 3, EIGHTH));
    apply(typeFret(state.doc, state.cursor, 5, EIGHTH));
    expect(show(state.doc)[0]).toBe('5.6:8 r:2. r:8');
    state = h.undo(state)!;
    expect(show(state.doc)[0]).toBe('3.6:8 r:2. r:8');
    state = h.undo(state)!;
    expect(show(state.doc)[0]).toBe('r:1');
    expect(h.undo(state)).toBeNull();
    state = h.redo(state)!;
    expect(show(state.doc)[0]).toBe('3.6:8 r:2. r:8');
    apply(typeFret(state.doc, state.cursor, 7, EIGHTH));
    expect(h.canRedo).toBe(false);
  });
});

describe('editor ⇄ alphaTab', () => {
  /** A song using everything the editor can write. */
  function everything(): SongDoc {
    let e = run(
      song([GUITAR, BASS], 3),
      START,
      (d, c) => typeFret(d, c, 3, EIGHTH),
      (d, c) => toggleNoteFlag(d, c, 'hammer'),
      (d, c) => moveBeat(d, c, 1),
      (d, c) => typeFret(d, c, 5, EIGHTH),
      (d, c) => toggleNoteFlag(d, c, 'palmMute'),
      (d, c) => moveBeat(d, c, 1),
      (d, c) => typeFret(d, c, 0, { duration: 4, dotted: true }),
      (d, c) => moveString(d, c, -1),
      (d, c) => typeFret(d, c, 2, EIGHTH),
      (d, c) => toggleNoteFlag(d, c, 'letRing'),
      (d, c) => moveBeat(d, c, 1),
      (d, c) => typeFret(d, c, 7, { duration: 8, triplet: true }),
      (d, c) => toggleNoteFlag(d, c, 'slide'),
      (d, c) => moveBeat(d, c, 1),
      (d, c) => typeFret(d, c, 9, { duration: 8, triplet: true }),
      (d, c) => toggleNoteFlag(d, c, 'vibrato'),
      (d, c) => moveBeat(d, c, 1),
      (d, c) => typeFret(d, c, 7, { duration: 8, triplet: true }),
      (d, c) => toggleNoteFlag(d, c, 'bend'),
      (d, c) => toggleRepeatStart(d, c),
      (d, c) => setSection(d, c, 'Intro "riff"'),
    );
    e = typeFret(e.doc, { ...START, bar: 1, string: 3 }, 0, EIGHTH);
    e = toggleNoteFlag(e.doc, e.cursor, 'dead');
    e = moveBeat(e.doc, e.cursor, 1);
    e = typeFret(e.doc, e.cursor, 4, { duration: 2 });
    e = moveBeat(e.doc, e.cursor, 1);
    e = typeFret(e.doc, e.cursor, 4, EIGHTH);
    e = toggleNoteFlag(e.doc, e.cursor, 'tie');
    e = cycleRepeatEnd(e.doc, e.cursor);
    e = setBarTempo(e.doc, { ...e.cursor, bar: 2 }, 140);
    e = setTimeSignature(e.doc, { ...e.cursor, bar: 2 }, [3, 4]);
    e = typeFret(e.doc, { track: 1, bar: 0, beat: 0, string: 4 }, 3, { duration: 4 });
    return e.doc;
  }

  it('writes alphaTex that alphaTab parses, with the right pitches', () => {
    const doc = everything();
    const score = parse(docToTex(doc));
    expect(score.title).toBe('Test "Riff"');
    expect(score.tempo).toBe(100);
    expect(score.tracks.map((t) => t.staves[0].tuning)).toEqual([GUITAR.tuning, BASS.tuning]);
    // Fret 3 on the low E string is G2 (MIDI 43); fret 3 on the bass E string is G1 (31).
    expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].realValue).toBe(43);
    expect(score.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].realValue).toBe(31);
    // Every bar lasts what its time signature says.
    for (const track of score.tracks) {
      for (const bar of track.staves[0].bars) expect(bar.calculateDuration()).toBe(barTicks([bar.masterBar.timeSignatureNumerator, bar.masterBar.timeSignatureDenominator]));
    }
    const [mb0, mb1, mb2] = score.masterBars;
    expect(mb0.isRepeatStart).toBe(true);
    expect(mb0.section?.text).toBe('Intro "riff"');
    expect(mb1.repeatCount).toBe(2);
    expect(mb2.tempoAutomations[0]?.value).toBe(140);
    expect([mb2.timeSignatureNumerator, mb2.timeSignatureDenominator]).toEqual([3, 4]);
  });

  it('reads back exactly what it wrote', () => {
    const doc = everything();
    const { doc: back, dropped } = scoreToDoc(parse(docToTex(doc)));
    expect(dropped).toEqual([]);
    expect(back).toEqual(doc);
  });

  it('survives a Guitar Pro 7 export and import', () => {
    const doc = everything();
    const settings = new alphaTab.Settings();
    const gp = new alphaTab.exporter.Gp7Exporter().export(parse(docToTex(doc)), settings);
    const { doc: back } = scoreToDoc(alphaTab.importer.ScoreLoader.loadScoreFromBytes(gp, settings));
    expect(show(back, 0)).toEqual(show(doc, 0));
    expect(show(back, 1)).toEqual(show(doc, 1));
    expect(back.bars[0].tracks[0].flatMap((b) => b.notes)).toEqual(doc.bars[0].tracks[0].flatMap((b) => b.notes));
  });

  it('lists what it leaves out of tabs not written in Fretlane', () => {
    const tex = String.raw`\title "Other"
\track "Gtr"
\staff {tabs}
\tuning (e4 b3 g3 d3 a2 e2)
:16 3.6 5.6 3.6 5.6 :4 3.6{gr} 5.6 :2 r |
\track "Drums"
\instrument percussion
\staff {score}
:4 36 38 36 38 |`;
    const { doc, dropped } = scoreToDoc(parse(tex));
    expect(doc.tracks.map((t) => t.name)).toEqual(['Gtr']);
    expect(dropped).toEqual(expect.arrayContaining(['track "Drums" (drums)', 'grace notes']));
  });

  it('opens the demo songs, which were not written in the editor', () => {
    for (const file of ['first-steps.atex', 'rotterdam-riff.atex']) {
      const tex = readFileSync(`demo/${file}`, 'utf8');
      const { doc } = scoreToDoc(parse(tex));
      expect(doc.bars.length).toBeGreaterThan(0);
      // And the editor's own output of it parses again.
      expect(() => parse(docToTex(doc))).not.toThrow();
    }
  });
});
