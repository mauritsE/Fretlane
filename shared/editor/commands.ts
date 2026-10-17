/**
 * Every edit the tab editor can make, as a pure function: (document, cursor, …) → Edit. Nothing is
 * mutated; an edit copies the bars it changes, so the previous document stays valid for undo.
 *
 * Bars are kept full where possible, the way Guitar Pro does it: a new bar is filled with rests,
 * typing a note into a rest takes its place, a longer note eats the rests after it, and a shorter one
 * leaves a rest behind. Notes are never removed to make room; a bar that still doesn't add up is
 * flagged by barStatus() instead.
 */
import {
  barTicks,
  beatTicks,
  clampTempo,
  emptyBar,
  restsFor,
  voiceTicks,
  type DocBar,
  type DocBeat,
  type DocNote,
  type DocTrack,
  type DurationValue,
  type SongDoc,
} from './doc.ts';

export interface Cursor {
  track: number;
  bar: number;
  beat: number;
  /** alphaTex string number: 1 = highest string. */
  string: number;
}

/** What a new note gets: the duration picked in the toolbar. */
export interface Entry {
  duration: DurationValue;
  dotted?: boolean;
  triplet?: boolean;
}

export interface Edit {
  doc: SongDoc;
  cursor: Cursor;
  /** First bar whose content changed, or -1 when the document is unchanged (only the cursor moved). */
  changedBar: number;
  /** A short note for the user, e.g. why nothing happened. */
  message?: string;
}

export const MAX_FRET = 30;

// ---------- small immutable helpers ----------

function same(doc: SongDoc, cursor: Cursor, message?: string): Edit {
  return { doc, cursor, changedBar: -1, ...(message ? { message } : {}) };
}

function withBar(doc: SongDoc, index: number, bar: DocBar): SongDoc {
  const bars = doc.bars.slice();
  bars[index] = bar;
  return { ...doc, bars };
}

function withVoice(doc: SongDoc, barIndex: number, track: number, beats: DocBeat[]): SongDoc {
  const bar = doc.bars[barIndex];
  const tracks = bar.tracks.slice();
  tracks[track] = beats;
  return withBar(doc, barIndex, { ...bar, tracks });
}

function cloneBeat(b: DocBeat): DocBeat {
  return { ...b, notes: b.notes.map((n) => ({ ...n })) };
}

export function cloneBar(b: DocBar): DocBar {
  return { ...b, ts: [b.ts[0], b.ts[1]], tracks: b.tracks.map((v) => v.map(cloneBeat)) };
}

function voice(doc: SongDoc, c: Cursor): DocBeat[] {
  return doc.bars[c.bar]?.tracks[c.track] ?? [];
}

function stringCount(doc: SongDoc, track: number): number {
  return doc.tracks[track]?.tuning.length ?? 6;
}

/** Keeps the cursor on an existing bar, beat and string. */
export function clampCursor(doc: SongDoc, c: Cursor): Cursor {
  const track = Math.min(Math.max(0, c.track), doc.tracks.length - 1);
  const bar = Math.min(Math.max(0, c.bar), doc.bars.length - 1);
  const beats = doc.bars[bar].tracks[track]?.length ?? 1;
  return {
    track,
    bar,
    beat: Math.min(Math.max(0, c.beat), Math.max(0, beats - 1)),
    string: Math.min(Math.max(1, c.string), stringCount(doc, track)),
  };
}

/**
 * Makes a voice add up to `expected` ticks by adding or removing rests, either right after beat
 * `at` (when a beat got longer or shorter, so later notes keep their place) or at the end of the bar
 * (when a beat was inserted or deleted, so everything after it shifts). Only rests are removed.
 */
export function fitVoice(beats: DocBeat[], expected: number, at: number, where: 'after' | 'end'): DocBeat[] {
  let out = beats.slice();
  let diff = voiceTicks(out) - expected;
  if (diff > 0) {
    if (where === 'after') {
      // Take the room from the first rests after the beat; notes in between move along.
      let i = at + 1;
      while (diff > 0 && i < out.length) {
        if (out[i].notes.length) {
          i++;
          continue;
        }
        diff -= beatTicks(out[i]);
        out.splice(i, 1);
      }
      if (diff < 0) out.splice(i, 0, ...restsFor(-diff));
    } else {
      let i = out.length - 1;
      while (diff > 0 && i > at && !out[i].notes.length) {
        diff -= beatTicks(out[i]);
        out.splice(i, 1);
        i--;
      }
      if (diff < 0) out.splice(i + 1, 0, ...restsFor(-diff));
    }
  } else if (diff < 0) {
    out.splice(where === 'after' ? at + 1 : out.length, 0, ...restsFor(-diff));
  }
  out = mergeRests(out, at + 1);
  return out;
}

/** Rewrites each run of plain rests from index `from` on as the fewest rests (r:4 r:8 → r:4.). */
function mergeRests(beats: DocBeat[], from: number): DocBeat[] {
  const out = beats.slice(0, Math.max(0, from));
  let run: DocBeat[] = [];
  const flush = () => {
    if (run.length > 1) out.push(...restsFor(voiceTicks(run)));
    else out.push(...run);
    run = [];
  };
  for (const b of beats.slice(Math.max(0, from))) {
    if (!b.notes.length && !b.triplet) run.push(b);
    else {
      flush();
      out.push(b);
    }
  }
  flush();
  return out;
}

// ---------- cursor movement ----------

/**
 * Next or previous beat. Moving right from the last beat of the last bar adds a bar, so a riff
 * can be typed without reaching for the mouse.
 */
export function moveBeat(doc: SongDoc, c: Cursor, dir: 1 | -1): Edit {
  const beats = voice(doc, c);
  if (dir > 0) {
    if (c.beat < beats.length - 1) return same(doc, { ...c, beat: c.beat + 1 });
    if (c.bar < doc.bars.length - 1) return same(doc, { ...c, bar: c.bar + 1, beat: 0 });
    const next = { ...doc, bars: [...doc.bars, emptyBar(doc.bars[c.bar].ts, doc.tracks.length)] };
    return { doc: next, cursor: { ...c, bar: c.bar + 1, beat: 0 }, changedBar: c.bar + 1 };
  }
  if (c.beat > 0) return same(doc, { ...c, beat: c.beat - 1 });
  if (c.bar > 0) {
    const prev = doc.bars[c.bar - 1].tracks[c.track]?.length ?? 1;
    return same(doc, { ...c, bar: c.bar - 1, beat: Math.max(0, prev - 1) });
  }
  return same(doc, c);
}

/** dir -1 = up (towards the highest string), +1 = down. */
export function moveString(doc: SongDoc, c: Cursor, dir: 1 | -1): Edit {
  const string = Math.min(Math.max(1, c.string + dir), stringCount(doc, c.track));
  return same(doc, { ...c, string });
}

export function moveBar(doc: SongDoc, c: Cursor, dir: 1 | -1): Edit {
  return same(doc, clampCursor(doc, { ...c, bar: c.bar + dir, beat: 0 }));
}

// ---------- notes ----------

/** Puts a fret on the cursor string. A rest becomes a note of the toolbar's duration. */
export function typeFret(doc: SongDoc, c: Cursor, fret: number, entry: Entry): Edit {
  if (!Number.isInteger(fret) || fret < 0 || fret > MAX_FRET) return same(doc, c, `Frets go from 0 to ${MAX_FRET}.`);
  // On drums any digit is a hit on the cursor's drum; there are no frets.
  if (doc.tracks[c.track]?.kind === 'drums') fret = 0;
  const beats = voice(doc, c);
  const beat = beats[c.beat];
  if (!beat) return same(doc, c);
  const note: DocNote = { string: c.string, fret };
  let next = beats.slice();
  if (!beat.notes.length) {
    next[c.beat] = { duration: entry.duration, ...(entry.dotted ? { dotted: true } : {}), ...(entry.triplet ? { triplet: true } : {}), notes: [note] };
    next = fitVoice(next, barTicks(doc.bars[c.bar].ts), c.beat, 'after');
  } else {
    const notes = beat.notes.filter((n) => n.string !== c.string);
    const old = beat.notes.find((n) => n.string === c.string);
    // Keep techniques on the note being retyped, but a typed fret is never a tie or a dead note.
    notes.push(old ? { ...old, fret, tie: undefined, dead: undefined } : note);
    next[c.beat] = { ...beat, notes: sortNotes(notes) };
  }
  return { doc: withVoice(doc, c.bar, c.track, next), cursor: c, changedBar: c.bar };
}

function sortNotes(notes: DocNote[]): DocNote[] {
  return notes
    .map((n) => Object.fromEntries(Object.entries(n).filter(([, v]) => v !== undefined)) as unknown as DocNote)
    .sort((a, b) => a.string - b.string);
}

/** Delete: removes the note under the cursor; on a string without a note, removes the beat. */
export function deleteAtCursor(doc: SongDoc, c: Cursor): Edit {
  const beat = voice(doc, c)[c.beat];
  if (!beat) return same(doc, c);
  if (beat.notes.some((n) => n.string === c.string)) {
    const beats = voice(doc, c).slice();
    beats[c.beat] = { ...beat, notes: beat.notes.filter((n) => n.string !== c.string) };
    return { doc: withVoice(doc, c.bar, c.track, beats), cursor: c, changedBar: c.bar };
  }
  return deleteBeat(doc, c);
}

/** Removes the beat under the cursor; later beats move left and a rest fills the end of the bar. */
export function deleteBeat(doc: SongDoc, c: Cursor): Edit {
  const beats = voice(doc, c);
  if (!beats[c.beat]) return same(doc, c);
  if (beats.length === 1 && !beats[0].notes.length) return same(doc, c, 'The bar is already empty.');
  const rest = beats.slice(0, c.beat).concat(beats.slice(c.beat + 1));
  const next = fitVoice(rest, barTicks(doc.bars[c.bar].ts), c.beat - 1, 'end');
  const out = withVoice(doc, c.bar, c.track, next);
  return { doc: out, cursor: clampCursor(out, c), changedBar: c.bar };
}

/** Inserts a rest of the toolbar's duration before the cursor (rests at the end of the bar make room). */
export function insertBeat(doc: SongDoc, c: Cursor, entry: Entry): Edit {
  const beats = voice(doc, c).slice();
  const rest: DocBeat = { duration: entry.duration, ...(entry.dotted ? { dotted: true } : {}), ...(entry.triplet ? { triplet: true } : {}), notes: [] };
  beats.splice(c.beat, 0, rest);
  const next = fitVoice(beats, barTicks(doc.bars[c.bar].ts), c.beat, 'end');
  return { doc: withVoice(doc, c.bar, c.track, next), cursor: c, changedBar: c.bar };
}

/** Turns the beat into a rest of the same length. */
export function makeRest(doc: SongDoc, c: Cursor): Edit {
  const beats = voice(doc, c).slice();
  const beat = beats[c.beat];
  if (!beat || !beat.notes.length) return same(doc, c);
  beats[c.beat] = { ...beat, notes: [] };
  return { doc: withVoice(doc, c.bar, c.track, beats), cursor: c, changedBar: c.bar };
}

function reshape(doc: SongDoc, c: Cursor, change: (b: DocBeat) => DocBeat): Edit {
  const beats = voice(doc, c).slice();
  const beat = beats[c.beat];
  if (!beat) return same(doc, c);
  beats[c.beat] = change(beat);
  const next = fitVoice(beats, barTicks(doc.bars[c.bar].ts), c.beat, 'after');
  return { doc: withVoice(doc, c.bar, c.track, next), cursor: c, changedBar: c.bar };
}

export function setDuration(doc: SongDoc, c: Cursor, duration: DurationValue): Edit {
  return reshape(doc, c, (b) => ({ ...b, duration }));
}

export function toggleDotted(doc: SongDoc, c: Cursor): Edit {
  return reshape(doc, c, (b) => strip({ ...b, dotted: !b.dotted }));
}

export function toggleTriplet(doc: SongDoc, c: Cursor): Edit {
  return reshape(doc, c, (b) => strip({ ...b, triplet: !b.triplet }));
}

function strip(b: DocBeat): DocBeat {
  const out: DocBeat = { duration: b.duration, notes: b.notes };
  if (b.dotted) out.dotted = true;
  if (b.triplet) out.triplet = true;
  return out;
}

export type NoteFlag = 'hammer' | 'slide' | 'vibrato' | 'bend' | 'palmMute' | 'letRing' | 'dead' | 'tie';

export const NOTE_FLAG_LABELS: Record<NoteFlag, string> = {
  hammer: 'Hammer-on / pull-off',
  slide: 'Slide',
  vibrato: 'Vibrato',
  bend: 'Bend (full)',
  palmMute: 'Palm mute',
  letRing: 'Let ring',
  dead: 'Dead note',
  tie: 'Tie',
};

/** Switches a technique on or off for the note under the cursor. */
export function toggleNoteFlag(doc: SongDoc, c: Cursor, flag: NoteFlag): Edit {
  if (doc.tracks[c.track]?.kind === 'drums') return same(doc, c, 'Techniques are for guitar and bass.');
  const beats = voice(doc, c).slice();
  const beat = beats[c.beat];
  const note = beat?.notes.find((n) => n.string === c.string);
  if (!beat || !note) return same(doc, c, 'Put a note on this string first.');
  const on = !note[flag];
  const changed: DocNote = { ...note, [flag]: on || undefined };
  if (flag === 'tie' && on) {
    const prev = previousNote(doc, c);
    if (!prev) return same(doc, c, 'A tie needs a note on the same string just before it.');
    changed.fret = prev.fret;
    changed.dead = undefined;
  }
  if (flag === 'dead' && on) changed.tie = undefined;
  beats[c.beat] = { ...beat, notes: sortNotes([...beat.notes.filter((n) => n !== note), changed]) };
  return { doc: withVoice(doc, c.bar, c.track, beats), cursor: c, changedBar: c.bar };
}

/** The note on the cursor's string in the beat just before the cursor (possibly in the previous bar). */
function previousNote(doc: SongDoc, c: Cursor): DocNote | undefined {
  let bar = c.bar;
  let beat = c.beat - 1;
  if (beat < 0) {
    bar--;
    if (bar < 0) return undefined;
    beat = (doc.bars[bar].tracks[c.track]?.length ?? 0) - 1;
  }
  return doc.bars[bar]?.tracks[c.track]?.[beat]?.notes.find((n) => n.string === c.string);
}

// ---------- bars ----------

export interface BarRange {
  from: number;
  to: number;
}

export function normalizeRange(r: BarRange, doc: SongDoc): BarRange {
  const a = Math.min(Math.max(0, Math.min(r.from, r.to)), doc.bars.length - 1);
  const b = Math.min(Math.max(0, Math.max(r.from, r.to)), doc.bars.length - 1);
  return { from: a, to: b };
}

export function insertBar(doc: SongDoc, c: Cursor, where: 'before' | 'after' = 'after'): Edit {
  const at = where === 'after' ? c.bar + 1 : c.bar;
  const bars = doc.bars.slice();
  bars.splice(at, 0, emptyBar(doc.bars[c.bar].ts, doc.tracks.length));
  return { doc: { ...doc, bars }, cursor: { ...c, bar: at, beat: 0 }, changedBar: at };
}

export function deleteBars(doc: SongDoc, c: Cursor, range: BarRange): Edit {
  const r = normalizeRange(range, doc);
  const bars = doc.bars.slice();
  const ts = bars[r.from].ts;
  bars.splice(r.from, r.to - r.from + 1);
  if (!bars.length) bars.push(emptyBar(ts, doc.tracks.length));
  const out = { ...doc, bars };
  return { doc: out, cursor: clampCursor(out, { ...c, bar: r.from, beat: 0 }), changedBar: Math.min(r.from, bars.length - 1) };
}

/** A deep copy of the bars in the range (all tracks), for the clipboard. */
export function copyBars(doc: SongDoc, range: BarRange): DocBar[] {
  const r = normalizeRange(range, doc);
  return doc.bars.slice(r.from, r.to + 1).map(cloneBar);
}

/** Inserts copied bars after the cursor's bar. Bars copied with fewer tracks get empty voices. */
export function pasteBars(doc: SongDoc, c: Cursor, clip: DocBar[]): Edit {
  if (!clip.length) return same(doc, c, 'Copy some bars first.');
  const fitted = clip.map((b) => {
    const bar = cloneBar(b);
    bar.tracks = doc.tracks.map((_, i) => bar.tracks[i] ?? restsFor(barTicks(bar.ts)));
    return bar;
  });
  const bars = doc.bars.slice();
  bars.splice(c.bar + 1, 0, ...fitted);
  return { doc: { ...doc, bars }, cursor: { ...c, bar: c.bar + 1, beat: 0 }, changedBar: c.bar + 1 };
}

export function toggleRepeatStart(doc: SongDoc, c: Cursor): Edit {
  const bar = { ...doc.bars[c.bar] };
  if (bar.repeatStart) delete bar.repeatStart;
  else bar.repeatStart = true;
  return { doc: withBar(doc, c.bar, bar), cursor: c, changedBar: c.bar };
}

/** Cycles the repeat end of a bar: none → ×2 → ×3 → ×4 → none. */
export function cycleRepeatEnd(doc: SongDoc, c: Cursor): Edit {
  const bar = { ...doc.bars[c.bar] };
  const next = !bar.repeatEnd ? 2 : bar.repeatEnd >= 4 ? 0 : bar.repeatEnd + 1;
  if (next) bar.repeatEnd = next;
  else delete bar.repeatEnd;
  return { doc: withBar(doc, c.bar, bar), cursor: c, changedBar: c.bar };
}

export function setSection(doc: SongDoc, c: Cursor, name: string): Edit {
  const bar = { ...doc.bars[c.bar] };
  const text = name.trim();
  if (text) bar.section = text;
  else delete bar.section;
  return { doc: withBar(doc, c.bar, bar), cursor: c, changedBar: c.bar };
}

/** A tempo change from this bar on; for the first bar it changes the song tempo. Empty removes it. */
export function setBarTempo(doc: SongDoc, c: Cursor, bpm: number | null): Edit {
  if (c.bar === 0) return bpm ? { doc: { ...doc, tempo: clampTempo(bpm) }, cursor: c, changedBar: 0 } : same(doc, c);
  const bar = { ...doc.bars[c.bar] };
  if (bpm) bar.tempo = clampTempo(bpm);
  else delete bar.tempo;
  return { doc: withBar(doc, c.bar, bar), cursor: c, changedBar: c.bar };
}

/**
 * Changes the time signature from the cursor's bar up to the next bar that already had a different
 * one. Each changed bar is fitted to its new length (rests are added or trimmed at the end).
 */
export function setTimeSignature(doc: SongDoc, c: Cursor, ts: [number, number]): Edit {
  const old = doc.bars[c.bar].ts;
  if (old[0] === ts[0] && old[1] === ts[1]) return same(doc, c);
  const bars = doc.bars.slice();
  for (let i = c.bar; i < bars.length && bars[i].ts[0] === old[0] && bars[i].ts[1] === old[1]; i++) {
    const expected = barTicks(ts);
    bars[i] = { ...bars[i], ts: [ts[0], ts[1]], tracks: bars[i].tracks.map((v) => fitVoice(v, expected, -1, 'end')) };
  }
  const out = { ...doc, bars };
  return { doc: out, cursor: clampCursor(out, c), changedBar: c.bar };
}

// ---------- song and tracks ----------

export function setSongInfo(doc: SongDoc, c: Cursor, info: { title?: string; artist?: string; tempo?: number }): Edit {
  const next = { ...doc };
  if (info.title !== undefined) next.title = info.title.trim() || doc.title;
  if (info.artist !== undefined) next.artist = info.artist.trim() || doc.artist;
  if (info.tempo !== undefined) next.tempo = clampTempo(info.tempo);
  return { doc: next, cursor: c, changedBar: 0 };
}

export function addTrack(doc: SongDoc, c: Cursor, track: DocTrack): Edit {
  const index = doc.tracks.length;
  const out: SongDoc = {
    ...doc,
    tracks: [...doc.tracks, { ...track, tuning: [...track.tuning] }],
    bars: doc.bars.map((b) => ({ ...b, tracks: [...b.tracks, restsFor(barTicks(b.ts))] })),
  };
  return { doc: out, cursor: { track: index, bar: c.bar, beat: 0, string: track.tuning.length }, changedBar: 0 };
}

export function removeTrack(doc: SongDoc, c: Cursor, index: number): Edit {
  if (doc.tracks.length <= 1) return same(doc, c, 'A song needs at least one track.');
  const out: SongDoc = {
    ...doc,
    tracks: doc.tracks.filter((_, i) => i !== index),
    bars: doc.bars.map((b) => ({ ...b, tracks: b.tracks.filter((_, i) => i !== index) })),
  };
  return { doc: out, cursor: clampCursor(out, { ...c, track: Math.min(c.track, out.tracks.length - 1) }), changedBar: 0 };
}

/**
 * Renames, re-voices or retunes a track. Frets stay as written (that is what retuning means on a
 * guitar). With fewer strings, notes on strings that no longer exist are dropped and counted.
 */
export function updateTrack(doc: SongDoc, c: Cursor, index: number, change: Partial<Pick<DocTrack, 'name' | 'sound' | 'tuning'>>): Edit {
  const track = doc.tracks[index];
  if (!track) return same(doc, c);
  // A drum track's lanes are its kit, not a tuning, and its sound is always the drum kit.
  if (track.kind === 'drums') change = change.name !== undefined ? { name: change.name } : {};
  const next: DocTrack = { ...track, ...change, tuning: [...(change.tuning ?? track.tuning)] };
  if (change.name !== undefined) next.name = change.name.trim() || track.name;
  const tracks = doc.tracks.slice();
  tracks[index] = next;
  let lost = 0;
  const strings = next.tuning.length;
  const bars =
    strings < track.tuning.length
      ? doc.bars.map((b) => {
          const v = b.tracks[index];
          if (!v.some((beat) => beat.notes.some((n) => n.string > strings))) return b;
          const voiceOut = v.map((beat) => {
            const notes = beat.notes.filter((n) => n.string <= strings);
            lost += beat.notes.length - notes.length;
            return { ...beat, notes };
          });
          const t = b.tracks.slice();
          t[index] = voiceOut;
          return { ...b, tracks: t };
        })
      : doc.bars;
  const out = { ...doc, tracks, bars };
  return {
    doc: out,
    cursor: clampCursor(out, c),
    changedBar: 0,
    ...(lost ? { message: `${lost} note${lost === 1 ? '' : 's'} on removed strings were dropped.` } : {}),
  };
}

// ---------- undo ----------

export interface Snapshot {
  doc: SongDoc;
  cursor: Cursor;
}

/** Undo/redo as a stack of whole documents (cheap: unchanged bars are shared between them). */
export class History {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];

  constructor(private readonly limit = 500) {}

  /** Call with the state from before an edit. */
  push(before: Snapshot): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: Snapshot): Snapshot | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: Snapshot): Snapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
