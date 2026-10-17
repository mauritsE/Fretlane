import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import type Anthropic from '@anthropic-ai/sdk';
import { DRUM_TUNING, TUNING_PRESETS, barStatus, drumLane, newSongDoc, type DocTrack, type SongDoc } from '../shared/editor/doc.ts';
import { typeFret, type Cursor } from '../shared/editor/commands.ts';
import { docToTex } from '../shared/editor/tex.ts';
import { scoreToDoc } from '../shared/editor/fromScore.ts';
import {
  MAX_RIFF_BARS,
  MAX_SONG_TRACKS,
  RIFF_SCHEMA,
  applyRiff,
  asciiTab,
  buildRiffRequest,
  describeWritten,
  riffFromAnswer,
  riffRequestProblem,
  riffUserMessage,
  type AiBeat,
  type AiPart,
  type AiRiff,
  type RiffRequest,
} from '../shared/editor/assistant.ts';
import { RIFF_MODEL, RiffAssistant, askClaude } from '../server/assistant.ts';
import type { FretlaneCloud } from '../server/cloud.ts';
import { HttpError } from '../server/library.ts';

const GUITAR: DocTrack = { name: 'Guitar', kind: 'guitar', sound: 'distortionguitar', tuning: TUNING_PRESETS.find((p) => p.id === 'guitar-drop-d')!.tuning };
const BASS: DocTrack = { name: 'Bass', kind: 'bass', sound: 'electricbassfinger', tuning: TUNING_PRESETS.find((p) => p.id === 'bass-standard')!.tuning };
const DRUMS: DocTrack = { name: 'Drums', kind: 'drums', sound: 'percussion', tuning: DRUM_TUNING };
const START: Cursor = { track: 0, bar: 0, beat: 0, string: 6 };

function song(tracks: DocTrack[] = [GUITAR], bars = 4): SongDoc {
  return newSongDoc({ title: 'Riffs', artist: 'Me', tempo: 140, ts: [4, 4], tracks, bars });
}

/** A song with notes on the low string in the given bars of track 0. */
function withNotes(doc: SongDoc, bars: number[], track = 0): SongDoc {
  for (const bar of bars) doc = typeFret(doc, { ...START, track, bar, string: doc.tracks[track].tuning.length }, bar + 1, { duration: 4 }).doc;
  return doc;
}

const note = (string: number, fret: number, techniques: AiPart['bars'][number]['beats'][number]['notes'][number]['techniques'] = []) => ({ string, fret, drum: 'none', techniques });
const hit = (...drums: string[]) => drums.map((drum) => ({ string: 0, fret: 0, drum, techniques: [] }));
const beat = (duration: AiBeat['duration'], notes: AiBeat['notes'], more: Partial<AiBeat> = {}): AiBeat => ({ duration, dotted: false, triplet: false, notes, ...more });

/** Eight eighth notes on string 6 (one 4/4 bar). */
function eighths(frets: number[], string = 6): AiPart['bars'][number] {
  return { beats: frets.map((fret) => beat(8, [note(string, fret)])) };
}
/** A rock beat: kick + hat, hat, snare + hat, hat … */
function rockBar(): AiPart['bars'][number] {
  return { beats: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => beat(8, hit(...(i % 4 === 0 ? ['kick', 'closedHiHat'] : i % 4 === 2 ? ['snare', 'closedHiHat'] : ['closedHiHat'])))) };
}
const part = (track: number, instrument: AiPart['instrument'], bars: AiPart['bars'], name = ''): AiPart => ({ track, instrument, name, bars });
const answer = (...parts: AiPart[]): AiRiff => ({ explanation: 'ok', parts });

function parse(tex: string): alphaTab.model.Score {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  return importer.readScore();
}

describe('riff requests', () => {
  it('lists every track and shows the selected bars on every track with notes', () => {
    let doc = withNotes(song([GUITAR, BASS, DRUMS]), [1, 2]);
    doc = typeFret(doc, { track: 2, bar: 1, beat: 0, string: drumLane('kick') }, 0, { duration: 4 }).doc;
    const req = buildRiffRequest(doc, 0, { mode: 'improve', range: { from: 2, to: 1 }, prompt: ' heavier ' });
    expect(req.mode).toBe('improve');
    expect(req.bars).toBe(2);
    expect(req.context).toContain('Tempo: 140 BPM. Time signature: 4/4.');
    expect(req.context).toContain('Tracks (the guitarist is working on track 1):');
    expect(req.context).toContain('Track 1 "Guitar": guitar, 6 strings');
    expect(req.context).toContain('string 1 = E4');
    expect(req.context).toContain('string 6 = D2');
    expect(req.context).toContain('Track 2 "Bass": bass, 4 strings');
    expect(req.context).toMatch(/Track 3 "Drums": drums \(crash, ride, .*kick\)/);
    expect(req.context).toContain('The selected bars (2–3)');
    expect(req.context).toContain('Bar 2 (4/4): s6f2 1/4');
    expect(req.context).toContain('Bar 2 (4/4): kick 1/4');
    // The empty bass track isn't shown; ASCII tab for the guitar, none for the drums.
    expect(req.context).not.toContain('Track 2 "Bass":\n');
    const tabLines = req.context.split('\n').filter((l) => /^[A-Ga-g]b?#? *\|/.test(l));
    expect(tabLines).toHaveLength(6);
    expect(tabLines[0].startsWith('e ')).toBe(true);
    expect(tabLines[5]).toMatch(/^D +\|-2.*\|-3/);
    expect(riffRequestProblem(req)).toBeNull();
    expect(riffUserMessage(req)).toContain('Every part you write has exactly 2 bars.');
    expect(riffUserMessage(req)).toContain('heavier');
  });

  it('shows what comes before a new riff, or says nothing has been written yet', () => {
    const empty = buildRiffRequest(song(), 0, { mode: 'generate', at: 0, bars: 4, prompt: 'a doom riff' });
    expect(empty.context).toContain('Nothing has been written before the new part yet.');
    expect(empty.bars).toBe(4);
    const doc = withNotes(song([GUITAR, BASS], 6), [2, 3], 1);
    const req = buildRiffRequest(doc, 0, { mode: 'generate', at: 5, bars: 2, prompt: 'answer it' });
    expect(req.context).toContain('What comes just before the new part:');
    // The bass has the notes; the guitar the user is on is shown too, even though it's empty.
    expect(req.context).toContain('Track 2 "Bass":\nBar 3 (4/4)');
    expect(req.context).toContain('Track 1 "Guitar":\nBar 3 (4/4)');
    expect(req.context).toContain('Bar 4 (4/4)');
    expect(req.context).not.toContain('Bar 2 (4/4)');
    expect(riffUserMessage(req)).toContain('Write something new of exactly 2 bars per part.');
  });

  it('refuses requests that are malformed or too big', () => {
    const ok: RiffRequest = { mode: 'generate', prompt: 'riff', bars: 2, context: 'Song' };
    expect(riffRequestProblem(ok)).toBeNull();
    expect(riffRequestProblem(null)).toMatch(/Missing/);
    expect(riffRequestProblem({ ...ok, mode: 'solo' })).toMatch(/mode/);
    expect(riffRequestProblem({ ...ok, prompt: '  ' })).toMatch(/Describe/);
    expect(riffRequestProblem({ ...ok, mode: 'improve', prompt: '' })).toBeNull();
    expect(riffRequestProblem({ ...ok, bars: MAX_RIFF_BARS + 1 })).toMatch(/bars/);
    expect(riffRequestProblem({ ...ok, bars: 1.5 })).toMatch(/bars/);
    expect(riffRequestProblem({ ...ok, prompt: 'x'.repeat(601) })).toMatch(/600/);
    expect(riffRequestProblem({ ...ok, context: 'x'.repeat(24_001) })).toMatch(/fewer bars/);
  });

  it('has a schema structured outputs accepts: every object closed and fully required', () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { type?: string; properties?: Record<string, unknown>; required?: readonly string[]; additionalProperties?: unknown; items?: unknown };
      if (n.type === 'object') {
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required ?? [])].sort()).toEqual(Object.keys(n.properties ?? {}).sort());
      }
      Object.values(n.properties ?? {}).forEach(walk);
      walk(n.items);
    };
    walk(RIFF_SCHEMA);
  });
});

describe('riffFromAnswer', () => {
  const at0 = { at: 0 };

  it('keeps a correct single-part riff as it is, on the existing track', () => {
    const r = riffFromAnswer({ explanation: ' A chug. ', parts: [part(1, 'guitar', [eighths([0, 0, 3, 0, 0, 5, 3, 0])])] }, song(), at0);
    expect(r.explanation).toBe('A chug.');
    expect(r.fixes).toEqual([]);
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0].track).toBe(0);
    expect(r.parts[0].bars[0][2]).toEqual({ duration: 8, notes: [{ string: 6, fret: 3 }] });
  });

  it('drops notes the instrument cannot play and doubled strings, and says so', () => {
    const r = riffFromAnswer(
      answer(part(1, 'guitar', [{ beats: [beat(2, [note(7, 0), note(6, 25), note(5, 2), note(5, 4)]), beat(2, [note(1, 12, ['vibrato', 'bogus' as never])])] }])),
      song(),
      at0,
    );
    expect(r.parts[0].bars[0][0].notes).toEqual([{ string: 5, fret: 2 }]);
    expect(r.parts[0].bars[0][1].notes).toEqual([{ string: 1, fret: 12, vibrato: true }]);
    expect(r.fixes).toEqual(["3 notes that didn't fit the instrument were left out."]);
  });

  it('fills a short bar with rests, cuts a long one, and fits each bar to the bar it goes into', () => {
    const short = { beats: eighths([0, 3, 5]).beats };
    const long = { beats: [...eighths([0, 0, 0, 0, 0, 0, 0, 0]).beats, ...eighths([7, 7]).beats] };
    const r = riffFromAnswer(answer(part(1, 'guitar', [short, long])), song(), at0);
    const doc = { ...song(), bars: r.parts[0].bars.map((v) => ({ ts: [4, 4] as [number, number], tracks: [v] })) };
    expect(barStatus(doc, 0, 0).diff).toBe(0);
    expect(barStatus(doc, 0, 1).diff).toBe(0);
    expect(r.parts[0].bars[1].every((b) => b.notes[0]?.fret === 0)).toBe(true);
    expect(r.fixes).toContain("2 bars didn't add up and were trimmed or filled with rests.");
    const waltz = newSongDoc({ title: 'W', artist: 'Me', tempo: 90, ts: [3, 4], tracks: [GUITAR], bars: 2 });
    expect(riffFromAnswer(answer(part(1, 'guitar', [eighths([0, 0, 0, 0, 0, 0, 0, 0])])), waltz, at0).parts[0].bars[0]).toHaveLength(6);
  });

  it('gives a tie the fret it holds, across bars, and drops a tie with nothing to hold', () => {
    const tie = (fret: number) => beat(2, [note(6, fret, ['tie'])]);
    const r = riffFromAnswer(
      answer(part(1, 'guitar', [{ beats: [tie(9), beat(2, [note(6, 5, ['dead'])])] }, { beats: [tie(0), beat(2, [note(6, 3, ['palmMute', 'hammer'])])] }])),
      song(),
      at0,
    );
    const bars = r.parts[0].bars;
    expect(bars[0][0].notes[0]).toEqual({ string: 6, fret: 9 });
    expect(bars[0][1].notes[0]).toEqual({ string: 6, fret: 5, dead: true });
    expect(bars[1][0].notes[0]).toEqual({ string: 6, fret: 5, tie: true });
    expect(bars[1][1].notes[0]).toEqual({ string: 6, fret: 3, hammer: true, palmMute: true });
  });

  it('writes drum parts as hits on the kit, ignoring strings, frets and techniques', () => {
    const r = riffFromAnswer(answer(part(0, 'drums', [{ beats: [beat(4, [...hit('kick', 'closedHiHat'), { string: 3, fret: 5, drum: 'snare', techniques: ['bend'] }, ...hit('cowbell', 'none', 'kick')]), beat(2, []), beat(4, hit('crash'))] }], 'Drums')), song(), at0);
    const p = r.parts[0];
    expect(p.track).toBeNull();
    expect(p.info).toMatchObject({ name: 'Drums', kind: 'drums', sound: 'percussion', tuning: DRUM_TUNING });
    expect(p.bars[0][0].notes).toEqual([drumLane('closedHiHat'), drumLane('snare'), drumLane('kick')].map((string) => ({ string, fret: 0 })));
    expect(p.bars[0][2].notes).toEqual([{ string: drumLane('crash'), fret: 0 }]);
    expect(r.fixes).toEqual(["3 notes that didn't fit the instrument were left out."]);
  });

  it('puts each part on a matching existing track, or a new one named by Claude with fitting defaults', () => {
    const doc = song([GUITAR, BASS]);
    const r = riffFromAnswer(
      answer(
        part(1, 'guitar', [eighths([0, 0, 0, 0, 0, 0, 0, 0])]),
        part(2, 'bass', [eighths([0, 0, 0, 0, 0, 0, 0, 0], 4)]),
        part(0, 'guitar', [eighths([7, 7, 7, 7, 7, 7, 7, 7], 4)], 'Harmony'),
        part(1, 'drums', [rockBar()], ''), // track 1 is a guitar: a drum part gets its own track
      ),
      doc,
      at0,
    );
    expect(r.parts.map((p) => [p.track, p.info.name, p.info.kind])).toEqual([
      [0, 'Guitar', 'guitar'],
      [1, 'Bass', 'bass'],
      [null, 'Harmony', 'guitar'],
      [null, 'Drums', 'drums'],
    ]);
    // A new guitar takes the song's guitar tuning and sound (drop D, distortion).
    expect(r.parts[2].info.tuning).toEqual(GUITAR.tuning);
    expect(r.parts[2].info.sound).toBe('distortionguitar');
  });

  it('gives every part the same number of bars, and at most the bars and parts allowed', () => {
    const r = riffFromAnswer(answer(part(1, 'guitar', [eighths([0, 0, 0, 0, 0, 0, 0, 0]), eighths([3, 3, 3, 3, 3, 3, 3, 3])]), part(0, 'drums', [rockBar()])), song(), at0);
    expect(r.parts.map((p) => p.bars.length)).toEqual([2, 2]);
    expect(r.parts[1].bars[1].every((b) => !b.notes.length)).toBe(true);
    const many = Array.from({ length: 10 }, () => eighths([0, 0, 0, 0, 0, 0, 0, 0]));
    expect(riffFromAnswer(answer(part(1, 'guitar', many)), song(), at0, 8).fixes[0]).toBe('Only the first 8 bars were kept.');
    const six = Array.from({ length: 6 }, (_, i) => part(0, 'guitar', [eighths([i, i, i, i, i, i, i, i])], `G${i}`));
    const capped = riffFromAnswer({ explanation: '', parts: six }, song(), at0);
    expect(capped.parts).toHaveLength(4);
    expect(capped.fixes).toContain('Only the first 4 parts were kept.');
    const full = song(Array.from({ length: MAX_SONG_TRACKS }, () => GUITAR));
    expect(riffFromAnswer(answer(part(1, 'guitar', [eighths([0, 0, 0, 0, 0, 0, 0, 0])]), part(0, 'drums', [rockBar()])), full, at0).fixes[0]).toMatch(/already has 8 tracks/);
  });

  it('refuses answers that are not riffs or have no notes', () => {
    expect(() => riffFromAnswer({ text: 'hi' }, song(), at0)).toThrow(/not a riff/);
    expect(() => riffFromAnswer({ explanation: '', bars: [] }, song(), at0)).toThrow(/not a riff/);
    expect(() => riffFromAnswer(answer(part(1, 'guitar', [{ beats: [beat(1, [])] }])), song(), at0)).toThrow(/without any notes/);
    expect(() => riffFromAnswer(answer({ ...part(1, 'guitar', [eighths([0, 0, 0, 0, 0, 0, 0, 0])]), instrument: 'piano' as never }), song(), at0)).toThrow(/without any notes/);
  });
});

describe('applyRiff', () => {
  const guitarRiff = (doc: SongDoc, n: number, target: { at?: number; replace?: { from: number; to: number } }) =>
    riffFromAnswer(answer(part(1, 'guitar', Array.from({ length: n }, (_, i) => eighths([i, i, i, i, i, i, i, i])))), doc, target);

  it('writes a new riff into empty bars from the cursor bar', () => {
    const doc = song();
    const e = applyRiff(doc, START, { at: 1 }, guitarRiff(doc, 2, { at: 1 }));
    expect(e.doc.bars).toHaveLength(4);
    expect(e.range).toEqual({ from: 1, to: 2 });
    expect(e.changedBar).toBe(1);
    expect(e.cursor).toMatchObject({ track: 0, bar: 1, beat: 0 });
    expect(e.doc.bars[1].tracks[0][0].notes[0].fret).toBe(0);
    expect(e.doc.bars[2].tracks[0][0].notes[0].fret).toBe(1);
    expect(doc.bars[1].tracks[0][0].notes).toEqual([]); // the old document is untouched (undo)
  });

  it('never writes over notes: a new riff is inserted before the next filled bar', () => {
    const doc = withNotes(song([GUITAR, BASS], 4), [2]);
    const e = applyRiff(doc, START, { at: 1 }, guitarRiff(doc, 3, { at: 1 }));
    expect(e.doc.bars).toHaveLength(6);
    expect(e.range).toEqual({ from: 1, to: 3 });
    expect(e.doc.bars[4].tracks[0][0].notes[0]).toEqual({ string: 6, fret: 3 }); // the old bar 3, moved along
    expect(e.doc.bars[2].tracks[1].every((b) => !b.notes.length)).toBe(true); // a new bar: rests on the bass
  });

  it('adds bars after the end of the song', () => {
    const doc = song([GUITAR], 2);
    const e = applyRiff(doc, START, { at: 2 }, guitarRiff(doc, 2, { at: 2 }));
    expect(e.doc.bars).toHaveLength(4);
    expect(e.range).toEqual({ from: 2, to: 3 });
  });

  it('improve replaces the selected bars on the written tracks and keeps the others', () => {
    let doc = withNotes(song([GUITAR, BASS], 4), [1, 2]);
    doc = typeFret(doc, { track: 1, bar: 1, beat: 0, string: 4 }, 5, { duration: 4 }).doc;
    const target = { replace: { from: 1, to: 2 } };
    const e = applyRiff(doc, START, target, guitarRiff(doc, 2, target));
    expect(e.doc.bars).toHaveLength(4);
    expect(e.range).toEqual({ from: 1, to: 2 });
    expect(e.doc.bars[1].tracks[0]).toHaveLength(8);
    expect(e.doc.bars[1].tracks[1][0].notes[0]).toEqual({ string: 4, fret: 5 });
  });

  it('improve with fewer bars than selected leaves rests; with more, inserts after the selection', () => {
    const doc = withNotes(song([GUITAR], 4), [0, 1, 2, 3]);
    const sel = { replace: { from: 1, to: 2 } };
    const fewer = applyRiff(doc, START, sel, guitarRiff(doc, 1, sel));
    expect(fewer.doc.bars[2].tracks[0].every((b) => !b.notes.length)).toBe(true);
    expect(fewer.range).toEqual({ from: 1, to: 2 });
    const one = { replace: { from: 1, to: 1 } };
    const more = applyRiff(doc, START, one, guitarRiff(doc, 2, one));
    expect(more.doc.bars).toHaveLength(5);
    expect(more.doc.bars[3].tracks[0][0].notes[0]).toEqual({ string: 6, fret: 3 });
  });

  it('adds new tracks for a bass line and drums under a selected riff, keeping the riff', () => {
    const doc = withNotes(song([GUITAR], 3), [0, 1]);
    const sel = { replace: { from: 0, to: 1 } };
    const riff = riffFromAnswer(answer(part(0, 'bass', [eighths([0, 0, 0, 0, 2, 2, 2, 2], 4), eighths([3, 3, 3, 3, 5, 5, 5, 5], 4)], 'Bass'), part(0, 'drums', [rockBar(), rockBar()], 'Drums')), doc, sel);
    const e = applyRiff(doc, { ...START, bar: 1 }, sel, riff);
    expect(e.doc.tracks.map((t) => `${t.name}:${t.kind}`)).toEqual(['Guitar:guitar', 'Bass:bass', 'Drums:drums']);
    expect(e.written).toEqual([{ track: 1, name: 'Bass', added: true }, { track: 2, name: 'Drums', added: true }]);
    expect(e.changedBar).toBe(0);
    expect(e.doc.bars).toHaveLength(3);
    // The guitar is untouched, the new tracks are filled in bars 1–2 and rest in bar 3.
    expect(e.doc.bars[0].tracks[0]).toEqual(doc.bars[0].tracks[0]);
    expect(e.doc.bars[0].tracks[1][4].notes).toEqual([{ string: 4, fret: 2 }]);
    expect(e.doc.bars[0].tracks[2][0].notes.map((n) => n.string)).toEqual([drumLane('closedHiHat'), drumLane('kick')]);
    expect(e.doc.bars[2].tracks[2].every((b) => !b.notes.length)).toBe(true);
    // The guitar wasn't written, so the cursor moves to the first new track, on its lowest string.
    expect(e.cursor).toMatchObject({ track: 1, bar: 0, string: 4 });
    expect(describeWritten(e.written, e.doc)).toBe('Bass (new track) and Drums (new track)');
    for (let b = 0; b < 3; b++) for (let t = 0; t < 3; t++) expect(barStatus(e.doc, t, b).diff).toBe(0);
  });

  it('a new riff with drums skips bars where the existing drum track already plays', () => {
    let doc = song([GUITAR, DRUMS], 4);
    doc = typeFret(doc, { track: 1, bar: 1, beat: 0, string: drumLane('kick') }, 0, { duration: 4 }).doc;
    const target = { at: 0 };
    const riff = riffFromAnswer(answer(part(1, 'guitar', [eighths([0, 0, 0, 0, 0, 0, 0, 0]), eighths([2, 2, 2, 2, 2, 2, 2, 2])]), part(2, 'drums', [rockBar(), rockBar()])), doc, target);
    const e = applyRiff(doc, START, target, riff);
    // Bar 1 is free on both tracks; bar 2 has a kick, so the second riff bar is inserted before it.
    expect(e.doc.bars).toHaveLength(5);
    expect(e.range).toEqual({ from: 0, to: 1 });
    expect(e.doc.bars[2].tracks[1][0].notes).toEqual([{ string: drumLane('kick'), fret: 0 }]);
    expect(e.cursor.track).toBe(0);
    expect(describeWritten(e.written, e.doc)).toBe('Guitar and Drums');
  });

  it('produces a song alphaTab can read, with every bar full, and that reopens unchanged', () => {
    const doc = withNotes(song([GUITAR, BASS], 3), [0]);
    const target = { at: 1 };
    const riff = riffFromAnswer(
      answer(
        part(1, 'guitar', [{ beats: [beat(4, [note(6, 0, ['palmMute']), note(5, 0, ['palmMute'])], { dotted: true }), ...Array.from({ length: 3 }, (_, i) => beat(8, [note(4, 2, i < 2 ? ['slide'] : [])], { triplet: true })), beat(2, [note(3, 4, ['bend', 'letRing'])])] }]),
        part(0, 'drums', [rockBar()], 'Drums'),
      ),
      doc,
      target,
    );
    const e = applyRiff(doc, START, target, riff);
    const tex = docToTex(e.doc);
    const score = parse(tex);
    expect(score.tracks).toHaveLength(3);
    expect(score.tracks[2].staves[0].isPercussion).toBe(true);
    for (let b = 0; b < 3; b++) for (let t = 0; t < 3; t++) expect(barStatus(e.doc, t, b).diff).toBe(0);
    expect(score.tracks[0].staves[0].bars[1].voices[0].beats[0].notes.map((n) => n.isPalmMute)).toEqual([true, true]);
    expect(docToTex(scoreToDoc(score).doc)).toBe(tex);
  });

  it('draws ASCII tab with wider columns for two-digit frets', () => {
    const doc = song();
    const riff = riffFromAnswer(answer(part(1, 'guitar', [{ beats: [beat(2, [note(6, 12)]), beat(2, [note(6, 3, ['dead'])])] }])), doc, { at: 0 });
    const tab = asciiTab([applyRiff(doc, START, { at: 0 }, riff).doc.bars[0]], 0, 6, ['e', 'B', 'G', 'D', 'A', 'D']).split('\n');
    expect(tab[5]).toBe('D |-12-x-|');
    expect(tab[0]).toBe('e |------|');
  });
});

describe('server: RiffAssistant', () => {
  const req: RiffRequest = { mode: 'generate', prompt: 'a riff', bars: 1, context: 'Song: "x"' };
  const reply: AiRiff = answer(part(1, 'guitar', [eighths([0, 0, 0, 0, 0, 0, 0, 0])]));

  function fakeClient(res: Partial<Anthropic.Beta.BetaMessage> | Error) {
    const calls: unknown[] = [];
    const client = {
      beta: {
        messages: {
          // Like the SDK: stream() returns at once, finalMessage() resolves or throws.
          stream: (params: unknown) => {
            calls.push(params);
            return { finalMessage: async () => (res instanceof Error ? Promise.reject(res) : res) };
          },
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  }

  it('calls Claude with the prompt, the schema and the fallback, and parses the JSON', async () => {
    const { client, calls } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) } as Anthropic.Beta.BetaTextBlock] });
    expect(await askClaude(client, req)).toEqual(reply);
    const params = calls[0] as Record<string, any>;
    expect(params.model).toBe(RIFF_MODEL);
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.max_tokens).toBe(64000);
    expect(params.output_config.format).toEqual({ type: 'json_schema', schema: RIFF_SCHEMA });
    expect(params.messages[0].content).toContain('Write something new of exactly 1 bar per part.');
    expect(params.system).toContain('write exactly one part: the track they are working on');
  });

  it('turns refusals, cut-off answers and broken JSON into readable errors', async () => {
    await expect(askClaude(fakeClient({ stop_reason: 'refusal', content: [] }).client, req)).rejects.toMatchObject({ status: 422 });
    await expect(askClaude(fakeClient({ stop_reason: 'max_tokens', content: [] }).client, req)).rejects.toThrow(/fewer bars/);
    await expect(askClaude(fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"parts": [' } as Anthropic.Beta.BetaTextBlock] }).client, req)).rejects.toThrow(/not a riff/);
    await expect(askClaude(fakeClient(new TypeError('fetch failed')).client, req)).rejects.toThrow(/Could not reach/);
  });

  it('uses Fretlane Cloud without an own key, and asks to sign in when signed out', async () => {
    let sent: unknown = null;
    const cloud = {
      status: () => ({ connected: sent !== 'signed-out', email: 'a@b.c', siteUrl: 'https://x' }),
      riffAssistant: async (r: RiffRequest) => {
        sent = r;
        return reply;
      },
    } as unknown as FretlaneCloud;
    const assistant = new RiffAssistant(cloud, undefined);
    expect(assistant.via).toBe('cloud');
    expect(await assistant.riff(req)).toEqual({ riff: reply, via: 'cloud' });
    expect(sent).toEqual(req);
    await expect(assistant.riff({ ...req, bars: 99 })).rejects.toBeInstanceOf(HttpError);
    sent = 'signed-out';
    await expect(assistant.riff(req)).rejects.toMatchObject({ status: 402 });
  });

  it('uses the own key when one is set', async () => {
    const { client } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) } as Anthropic.Beta.BetaTextBlock] });
    const assistant = new RiffAssistant({ status: () => ({ connected: false }) } as unknown as FretlaneCloud, undefined, client);
    expect(await assistant.riff(req)).toEqual({ riff: reply, via: 'own-key' });
  });
});
