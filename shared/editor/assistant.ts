/**
 * The songwriting assistant ("✨ Riff assistant" in the tab editor): Claude improves the bars the
 * user selected, or writes a new riff from a prompt when nothing is selected.
 *
 * This file holds everything both ends agree on, kept pure so vitest covers it:
 * - the request the editor sends (`RiffRequest`) and the text that describes the song to Claude,
 * - the system prompt and the JSON schema Claude's answer must follow (structured outputs),
 * - turning that answer back into editor bars (`riffToBars`), and the edit that puts them in the
 *   song (`applyRiff`), which is undoable like any other edit.
 *
 * The website (mauritsE/fretlane-sync-magic, src/lib/riffAssistant.ts) has a port of the prompt,
 * the schema and the request limits for Premium users who don't bring their own API key. Keep the
 * two in step.
 */
import { barTicks, beatTicks, instrumentLabel, pitchName, restsFor, voiceTicks, type DocBar, type DocBeat, type DocNote, type DurationValue, type SongDoc } from './doc.ts';
import { clampCursor, normalizeRange, type BarRange, type Cursor, type Edit } from './commands.ts';

export type RiffMode = 'improve' | 'generate';

/** What the editor asks for. `context` is built by buildRiffRequest() and describes the song. */
export interface RiffRequest {
  mode: RiffMode;
  /** The user's words: "make it heavier", "a funky sixteenth-note riff in E". May be empty for improve. */
  prompt: string;
  /** How many bars to write. For improve: the number of selected bars. */
  bars: number;
  context: string;
}

export const MAX_RIFF_BARS = 8;
export const MAX_PROMPT_CHARS = 600;
export const MAX_CONTEXT_CHARS = 12_000;
/** Highest fret the assistant may use (the editor allows up to MAX_FRET; riffs stay playable). */
export const RIFF_MAX_FRET = 24;

/** Checks a request's shape and size. Returns an error message, or null when it is fine. */
export function riffRequestProblem(req: unknown): string | null {
  const r = req as Partial<RiffRequest> | null;
  if (!r || typeof r !== 'object') return 'Missing request.';
  if (r.mode !== 'improve' && r.mode !== 'generate') return 'mode must be improve or generate.';
  if (typeof r.prompt !== 'string' || r.prompt.length > MAX_PROMPT_CHARS) return `Keep the prompt under ${MAX_PROMPT_CHARS} characters.`;
  if (r.mode === 'generate' && !r.prompt.trim()) return 'Describe the riff you want.';
  if (!Number.isInteger(r.bars) || r.bars! < 1 || r.bars! > MAX_RIFF_BARS) return `bars must be 1 to ${MAX_RIFF_BARS}.`;
  if (typeof r.context !== 'string' || !r.context || r.context.length > MAX_CONTEXT_CHARS) return 'The selection is too long for the assistant. Select fewer bars.';
  return null;
}

// ---------- what Claude answers ----------

export const RIFF_TECHNIQUES = ['hammer', 'slide', 'vibrato', 'bend', 'palmMute', 'letRing', 'dead', 'tie'] as const;
export type RiffTechnique = (typeof RIFF_TECHNIQUES)[number];

export interface AiNote {
  string: number;
  fret: number;
  techniques: RiffTechnique[];
}
export interface AiBeat {
  duration: DurationValue;
  dotted: boolean;
  triplet: boolean;
  /** Empty = a rest. */
  notes: AiNote[];
}
export interface AiRiff {
  /** One or two sentences for the user: what the riff does or what changed. */
  explanation: string;
  bars: { beats: AiBeat[] }[];
}

/** The JSON schema for structured outputs. Every object lists all its keys and allows no others. */
export const RIFF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['explanation', 'bars'],
  properties: {
    explanation: { type: 'string', description: 'One or two plain sentences for the guitarist: what the riff does, or what you changed and why.' },
    bars: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['beats'],
        properties: {
          beats: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['duration', 'dotted', 'triplet', 'notes'],
              properties: {
                duration: { type: 'integer', enum: [1, 2, 4, 8, 16, 32], description: '1 = whole note, 4 = quarter, 8 = eighth, 16 = sixteenth.' },
                dotted: { type: 'boolean' },
                triplet: { type: 'boolean', description: 'Part of a triplet: three of these take the time of two.' },
                notes: {
                  type: 'array',
                  description: 'Notes struck together on this beat, at most one per string. Empty means a rest.',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['string', 'fret', 'techniques'],
                    properties: {
                      string: { type: 'integer', description: '1 = the highest-pitched string (top line of the tab).' },
                      fret: { type: 'integer', description: '0 = open string.' },
                      techniques: { type: 'array', items: { type: 'string', enum: [...RIFF_TECHNIQUES] } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const RIFF_SYSTEM_PROMPT = `You are a songwriting partner for guitarists and bassists, working inside Fretlane, a tab editor. You write riffs as tab: each note is a string and a fret.

How to write:
- Write idiomatic, playable parts for the instrument and tuning you are given. Keep hand positions realistic: avoid stretches wider than about five frets within a beat, and don't jump around the neck without a musical reason.
- Every bar must add up exactly to its time signature. Count it: in 4/4 a bar holds four quarter notes, eight eighths or sixteen sixteenths; a dotted note lasts one and a half times its value; three triplet notes last as long as two plain ones, so triplets come in groups of three. Use rests (beats with no notes) for silence.
- String 1 is the highest-pitched string. Use only the strings that exist on the instrument and frets 0 to ${RIFF_MAX_FRET}.
- Techniques: hammer (hammer-on or pull-off into the next note on that string), slide (slide into the next note on that string), vibrato, bend (a full-tone bend), palmMute, letRing, dead (a muted, percussive note), tie (holds the previous note on that string; give it the same fret). Use them where a player would, not on every note.
- When improving a riff, keep what makes it recognisable (its key, its rhythmic identity, its best idea) unless the guitarist asks for something different, and return the same number of bars.
- When writing a new riff, follow the guitarist's description, and fit the key, feel and tempo of the music that comes before it if there is any.
- The explanation is one or two plain sentences: what the riff does, or what you changed. No tab, no lists.`;

/** The user turn sent to Claude. */
export function riffUserMessage(req: RiffRequest): string {
  const ask =
    req.mode === 'improve'
      ? `Improve the selected riff. Return exactly ${req.bars} bar${req.bars === 1 ? '' : 's'}.\nWhat the guitarist asked: ${req.prompt.trim() || 'Make it better: more musical, more interesting to play, without losing its character.'}`
      : `Write a new riff of exactly ${req.bars} bar${req.bars === 1 ? '' : 's'}.\nWhat the guitarist asked: ${req.prompt.trim()}`;
  return `${req.context}\n\n${ask}`;
}

// ---------- describing the song to Claude ----------

function tuningText(tuning: number[]): string {
  return tuning.map((p, i) => `string ${i + 1} = ${pitchName(p)}`).join(', ');
}

function beatText(beat: DocBeat): string {
  const len = `1/${beat.duration}${beat.dotted ? ' dotted' : ''}${beat.triplet ? ' triplet' : ''}`;
  if (!beat.notes.length) return `rest ${len}`;
  const notes = beat.notes.map((n) => {
    const tech = RIFF_TECHNIQUES.filter((t) => n[t]);
    return `s${n.string}f${n.fret}${tech.length ? `(${tech.join(',')})` : ''}`;
  });
  return `${notes.join('+')} ${len}`;
}

/** A bar as a list of beats, e.g. "s6f0 1/8 | s6f3(hammer) 1/8 | rest 1/4 …". */
function barText(bar: DocBar, track: number): string {
  return (bar.tracks[track] ?? []).map(beatText).join(' | ');
}

/** The bars as ASCII tab, highest string on top, so the shape of the riff is visible at a glance. */
export function asciiTab(bars: DocBar[], track: number, strings: number, labels: string[]): string {
  const rows = Array.from({ length: strings }, (_, i) => `${labels[i].padEnd(2)}|`);
  for (const bar of bars) {
    for (const beat of bar.tracks[track] ?? []) {
      const cells = Array.from({ length: strings }, (_, i) => {
        const n = beat.notes.find((x) => x.string === i + 1);
        return n ? (n.dead ? 'x' : n.tie ? `(${n.fret})` : String(n.fret)) : '';
      });
      const width = Math.max(1, ...cells.map((c) => c.length)) + 1;
      cells.forEach((c, i) => (rows[i] += `-${c.padEnd(width - 1, '-')}`));
    }
    for (let i = 0; i < strings; i++) rows[i] += '-|';
  }
  return rows.join('\n');
}

/**
 * Builds the request for the bars selected on `track` (improve) or for a new riff at `at`
 * (generate). The context names the instrument, tuning, tempo and time signature, and shows the
 * selected bars, or the bars just before the new riff, both as beat lists and as ASCII tab.
 */
export function buildRiffRequest(
  doc: SongDoc,
  track: number,
  opts: { mode: 'improve'; range: BarRange; prompt: string } | { mode: 'generate'; at: number; bars: number; prompt: string },
): RiffRequest {
  const t = doc.tracks[track];
  const strings = t.tuning.length;
  const labels = t.tuning.map((p) => pitchName(p).replace(/-?\d+$/, ''));
  const label = labels.map((l, i) => (i === 0 && t.kind === 'guitar' ? l.toLowerCase() : l));
  const first = opts.mode === 'improve' ? normalizeRange(opts.range, doc).from : Math.min(Math.max(0, opts.at), doc.bars.length - 1);
  const tempo = tempoAt(doc, first);
  const ts = doc.bars[first].ts;
  const lines = [
    `Song: "${doc.title}"`,
    `Instrument: ${instrumentLabel(t.kind).toLowerCase()}, ${strings} strings, sound "${t.sound}"`,
    `Tuning (highest string first): ${tuningText(t.tuning)}`,
    `Tempo: ${tempo} BPM. Time signature: ${ts[0]}/${ts[1]}.`,
  ];
  const show = (title: string, bars: DocBar[], from: number) => {
    lines.push('', title);
    bars.forEach((b, i) => lines.push(`Bar ${from + i + 1}${b.section ? ` [${b.section}]` : ''} (${b.ts[0]}/${b.ts[1]}): ${barText(b, track)}`));
    lines.push('', asciiTab(bars, track, strings, label));
  };
  if (opts.mode === 'improve') {
    const r = normalizeRange(opts.range, doc);
    const selected = doc.bars.slice(r.from, r.to + 1);
    show(`The selected riff (bars ${r.from + 1}–${r.to + 1}):`, selected, r.from);
    return { mode: 'improve', prompt: opts.prompt, bars: selected.length, context: lines.join('\n') };
  }
  // Up to two bars with notes just before the new riff, so it can follow on from them.
  const before: number[] = [];
  for (let i = first - 1; i >= 0 && before.length < 2; i--) if (hasNotes(doc.bars[i], track)) before.unshift(i);
  if (before.length) show('What comes just before the new riff:', before.map((i) => doc.bars[i]), before[0]);
  else lines.push('', 'Nothing has been written before the new riff yet.');
  return { mode: 'generate', prompt: opts.prompt, bars: Math.min(MAX_RIFF_BARS, Math.max(1, Math.round(opts.bars))), context: lines.join('\n') };
}

function tempoAt(doc: SongDoc, bar: number): number {
  for (let i = bar; i > 0; i--) if (doc.bars[i].tempo) return doc.bars[i].tempo!;
  return doc.tempo;
}

function hasNotes(bar: DocBar | undefined, track: number): boolean {
  return !!bar?.tracks[track]?.some((b) => b.notes.length);
}

// ---------- turning the answer into bars ----------

export interface RiffResult {
  /** One voice per bar, each already the right length for the bar it goes into. */
  bars: DocBeat[][];
  explanation: string;
  /** Things that were corrected, for an honest message to the user ("2 bars were trimmed to fit"). */
  fixes: string[];
}

const DURATION_SET = new Set<number>([1, 2, 4, 8, 16, 32]);

/**
 * Validates Claude's answer and makes it fit the track: notes on strings that don't exist or on
 * frets out of range are dropped, a second note on the same string in one beat is dropped, a tie
 * gets the fret of the note it holds (or stops being a tie), and each bar is cut or padded with
 * rests to the length of the bar it will go into (`tsFor(i)`). Throws when the answer has no
 * usable bars at all.
 */
export function riffToBars(raw: unknown, strings: number, tsFor: (i: number) => [number, number], maxBars = MAX_RIFF_BARS): RiffResult {
  const r = raw as Partial<AiRiff> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.bars)) throw new Error('The assistant sent back something that is not a riff. Try again.');
  const fixes: string[] = [];
  let dropped = 0;
  let fitted = 0;
  let rawBars = r.bars;
  if (rawBars.length > maxBars) {
    fixes.push(`Only the first ${maxBars} bars were kept.`);
    rawBars = rawBars.slice(0, maxBars);
  }
  /** The fret last played on each string, for ties across beats and bars. */
  const lastFret = new Map<number, number>();
  const bars = rawBars.map((bar, bi) => {
    const beats: DocBeat[] = [];
    for (const b of Array.isArray(bar?.beats) ? bar.beats : []) {
      if (!b || !DURATION_SET.has(b.duration)) {
        dropped++;
        continue;
      }
      const notes: DocNote[] = [];
      for (const n of Array.isArray(b.notes) ? b.notes : []) {
        const ok = n && Number.isInteger(n.string) && n.string >= 1 && n.string <= strings && Number.isInteger(n.fret) && n.fret >= 0 && n.fret <= RIFF_MAX_FRET;
        if (!ok || notes.some((x) => x.string === n.string)) {
          dropped++;
          continue;
        }
        const note: DocNote = { string: n.string, fret: n.fret };
        const tech = new Set(Array.isArray(n.techniques) ? n.techniques : []);
        for (const t of RIFF_TECHNIQUES) if (t !== 'tie' && t !== 'dead' && tech.has(t)) note[t] = true;
        if (tech.has('tie') && lastFret.has(n.string)) {
          note.tie = true;
          note.fret = lastFret.get(n.string)!;
        } else if (tech.has('dead')) note.dead = true;
        notes.push(note);
      }
      for (const n of notes) lastFret.set(n.string, n.fret);
      const beat: DocBeat = { duration: b.duration, notes: notes.sort((a, c) => a.string - c.string) };
      if (b.dotted) beat.dotted = true;
      if (b.triplet) beat.triplet = true;
      beats.push(beat);
    }
    const expected = barTicks(tsFor(bi));
    const out = fitToLength(beats, expected);
    if (out.changed) fitted++;
    return out.beats;
  });
  if (!bars.some((v) => v.some((b) => b.notes.length))) throw new Error('The assistant sent back a riff without any notes. Try again.');
  if (dropped) fixes.push(`${dropped} note${dropped === 1 ? '' : 's'} that didn't fit the instrument ${dropped === 1 ? 'was' : 'were'} left out.`);
  if (fitted) fixes.push(`${fitted} bar${fitted === 1 ? '' : 's'} didn't add up and ${fitted === 1 ? 'was' : 'were'} trimmed or filled with rests.`);
  return { bars, explanation: typeof r.explanation === 'string' ? r.explanation.trim() : '', fixes };
}

/** Keeps beats while they fit, then fills what's left with rests. */
function fitToLength(beats: DocBeat[], expected: number): { beats: DocBeat[]; changed: boolean } {
  if (voiceTicks(beats) === expected) return { beats, changed: false };
  const out: DocBeat[] = [];
  let used = 0;
  for (const b of beats) {
    if (used + beatTicks(b) > expected) break;
    out.push(b);
    used += beatTicks(b);
  }
  out.push(...restsFor(expected - used));
  return { beats: out, changed: true };
}

// ---------- putting the riff in the song ----------

export interface RiffTarget {
  /** improve: the selected bars, replaced by the new riff. */
  replace?: BarRange;
  /** generate: where the new riff starts. */
  at?: number;
}

/**
 * The time signature each riff bar will have, so riffToBars() can fit them. Replaced bars keep
 * theirs; new bars take the one of the bar they follow.
 */
export function riffTimeSignatures(doc: SongDoc, track: number, target: RiffTarget, count: number): [number, number][] {
  return planRiff(doc, track, target, count).map((p) => p.ts);
}

interface Slot {
  /** An existing bar to write into, or null to insert a new bar before `insertAt`. */
  bar: number | null;
  insertAt: number;
  ts: [number, number];
}

/**
 * Where each riff bar goes. Improve: over the selected bars, then (if Claude wrote more) new bars
 * after them. Generate: from `at` on, into bars that are still empty on this track, and as new bars
 * as soon as a bar with notes comes up, so a new riff never writes over notes.
 */
function planRiff(doc: SongDoc, track: number, target: RiffTarget, count: number): Slot[] {
  const slots: Slot[] = [];
  if (target.replace) {
    const r = normalizeRange(target.replace, doc);
    for (let i = 0; i < count; i++) {
      const bar = r.from + i <= r.to ? r.from + i : null;
      slots.push({ bar, insertAt: Math.min(r.from + i, r.to + 1), ts: doc.bars[Math.min(r.from + i, r.to)].ts });
    }
    return slots;
  }
  let i = Math.min(Math.max(0, target.at ?? 0), doc.bars.length);
  let inserting = false;
  for (let n = 0; n < count; n++) {
    if (!inserting && i < doc.bars.length && !hasNotes(doc.bars[i], track)) {
      slots.push({ bar: i, insertAt: i, ts: doc.bars[i].ts });
      i++;
    } else {
      inserting = true;
      slots.push({ bar: null, insertAt: i, ts: doc.bars[Math.max(0, Math.min(i, doc.bars.length) - 1)].ts });
    }
  }
  return slots;
}

/**
 * Writes the riff's bars into the song on `track` (see planRiff for where). Other tracks keep
 * their notes in replaced bars and get rests in new bars. For improve, selected bars beyond the
 * riff's length become rests on this track. Returns the edit and the bars the riff now occupies.
 */
export function applyRiff(doc: SongDoc, cursor: Cursor, track: number, target: RiffTarget, riff: DocBeat[][]): Edit & { range: BarRange } {
  const slots = planRiff(doc, track, target, riff.length);
  const bars = doc.bars.slice();
  let inserted = 0;
  let firstBar = -1;
  let lastBar = -1;
  slots.forEach((slot, i) => {
    if (slot.bar !== null) {
      const at = slot.bar + inserted;
      const tracks = bars[at].tracks.slice();
      tracks[track] = riff[i];
      bars[at] = { ...bars[at], tracks };
      if (firstBar < 0) firstBar = at;
      lastBar = at;
    } else {
      const at = slot.insertAt + inserted;
      const tracks = doc.tracks.map((_, ti) => (ti === track ? riff[i] : restsFor(barTicks(slot.ts))));
      bars.splice(at, 0, { ts: [slot.ts[0], slot.ts[1]], tracks });
      inserted++;
      if (firstBar < 0) firstBar = at;
      lastBar = at;
    }
  });
  if (target.replace) {
    const r = normalizeRange(target.replace, doc);
    for (let b = r.from + riff.length; b <= r.to; b++) {
      const at = b + inserted;
      const tracks = bars[at].tracks.slice();
      tracks[track] = restsFor(barTicks(bars[at].ts));
      bars[at] = { ...bars[at], tracks };
      lastBar = at;
    }
  }
  const out = { ...doc, bars };
  const next = clampCursor(out, { ...cursor, track, bar: firstBar, beat: 0 });
  return { doc: out, cursor: next, changedBar: firstBar, range: { from: firstBar, to: lastBar } };
}
