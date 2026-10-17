/**
 * The songwriting assistant ("✨ Riff assistant" in the tab editor): Claude improves the bars the
 * user selected, or writes a new riff from a prompt when nothing is selected. When asked, it also
 * writes the other parts that go with it, such as a second guitar, a bass line or drums, each on
 * its own track (an existing one, or a new one it names).
 *
 * This file holds everything both ends agree on, kept pure so vitest covers it:
 * - the request the editor sends (`RiffRequest`) and the text that describes the song to Claude,
 * - the system prompt and the JSON schema Claude's answer must follow (structured outputs),
 * - turning that answer into tracks and bars (`riffFromAnswer`), and the edit that puts them in the
 *   song (`applyRiff`), which is undoable like any other edit.
 *
 * The website (mauritsE/fretlane-sync-magic, src/lib/riffAssistant.ts) has a port of the prompt,
 * the schema and the request limits for Premium users who don't bring their own API key. Keep the
 * two in step.
 */
import {
  DEFAULT_SOUND,
  DRUM_KIT,
  DRUM_TUNING,
  TUNING_PRESETS,
  barTicks,
  beatTicks,
  drumLane,
  pitchName,
  restsFor,
  voiceTicks,
  type DocBar,
  type DocBeat,
  type DocNote,
  type DocTrack,
  type DurationValue,
  type SongDoc,
  type TrackKind,
} from './doc.ts';
import { clampCursor, normalizeRange, type BarRange, type Cursor, type Edit } from './commands.ts';

export type RiffMode = 'improve' | 'generate';

/** What the editor asks for. `context` is built by buildRiffRequest() and describes the song. */
export interface RiffRequest {
  mode: RiffMode;
  /** The user's words: "make it heavier", "add a bass line and drums". May be empty for improve. */
  prompt: string;
  /** How many bars to write. For improve: the number of selected bars. */
  bars: number;
  context: string;
}

export const MAX_RIFF_BARS = 8;
export const MAX_PROMPT_CHARS = 600;
export const MAX_CONTEXT_CHARS = 24_000;
/** Parts (tracks) one answer may write. */
export const MAX_RIFF_PARTS = 4;
/** The assistant doesn't add tracks beyond this many in a song. */
export const MAX_SONG_TRACKS = 8;
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
export const RIFF_INSTRUMENTS = ['guitar', 'bass', 'drums'] as const satisfies readonly TrackKind[];
export const RIFF_DRUMS = DRUM_KIT.map((d) => d.id);

export interface AiNote {
  /** Stringed parts: 1 = the highest string. 0 on drums. */
  string: number;
  fret: number;
  /** Drum parts: which drum. "none" on guitar and bass. */
  drum: string;
  techniques: RiffTechnique[];
}
export interface AiBeat {
  duration: DurationValue;
  dotted: boolean;
  triplet: boolean;
  /** Empty = a rest. */
  notes: AiNote[];
}
export interface AiPart {
  /** Number of an existing track (1 = the first), or 0 for a new track. */
  track: number;
  instrument: TrackKind;
  /** The track's name; used for a new track. */
  name: string;
  bars: { beats: AiBeat[] }[];
}
export interface AiRiff {
  /** One or two sentences for the user: what the riff does or what changed. */
  explanation: string;
  parts: AiPart[];
}

/** The JSON schema for structured outputs. Every object lists all its keys and allows no others. */
export const RIFF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['explanation', 'parts'],
  properties: {
    explanation: { type: 'string', description: 'One or two plain sentences for the guitarist: what you wrote, or what you changed and why.' },
    parts: {
      type: 'array',
      description: 'One entry per track you write. Only the parts the guitarist asked for.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['track', 'instrument', 'name', 'bars'],
        properties: {
          track: { type: 'integer', description: 'Number of an existing track to write into, or 0 to add a new track.' },
          instrument: { type: 'string', enum: [...RIFF_INSTRUMENTS] },
          name: { type: 'string', description: 'The track name, e.g. "Guitar 2", "Bass", "Drums".' },
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
                        description: 'Notes or drum hits struck together on this beat. Empty means a rest.',
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['string', 'fret', 'drum', 'techniques'],
                          properties: {
                            string: { type: 'integer', description: 'Guitar and bass: 1 = the highest-pitched string. Drums: 0.' },
                            fret: { type: 'integer', description: 'Guitar and bass: 0 = open string. Drums: 0.' },
                            drum: { type: 'string', enum: [...RIFF_DRUMS, 'none'], description: 'Drums: the drum hit. Guitar and bass: "none".' },
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
      },
    },
  },
} as const;

export const RIFF_SYSTEM_PROMPT = `You are a songwriting partner for guitarists and bassists, working inside Fretlane, a tab editor. You write parts as tab (each note is a string and a fret) and drum parts as drum hits.

Which parts to write:
- Write only the parts the guitarist asks for. When they don't mention other instruments, write exactly one part: the track they are working on.
- When they ask for more ("add a bass line", "with drums", "a second guitar harmonising it"), write each instrument as its own part. Use an existing track of that instrument when the song has one that fits, otherwise add a new track (track 0) with a short name such as "Guitar 2", "Bass" or "Drums".
- Every part covers the same bars and must lock in with the others and with the tracks already in the song: the bass follows the riff's roots and the kick, the drums support its rhythm, a second guitar harmonises or answers it.

How to write:
- Write idiomatic, playable parts for each instrument and tuning. Keep hand positions realistic: avoid stretches wider than about five frets within a beat, and don't jump around the neck without a musical reason.
- Every bar must add up exactly to its time signature. Count it: in 4/4 a bar holds four quarter notes, eight eighths or sixteen sixteenths; a dotted note lasts one and a half times its value; three triplet notes last as long as two plain ones, so triplets come in groups of three. Use rests (beats with no notes) for silence.
- Guitar and bass: string 1 is the highest-pitched string. Use only the strings the instrument has and frets 0 to ${RIFF_MAX_FRET}. Set drum to "none".
- Drums: each note is one drum hit (kick, snare, hi-hats, toms, crash, ride, side stick); set string and fret to 0 and use no techniques. Hits on the same beat are played together, like a kick with a closed hi-hat. Write a real drummer's groove, not a hit on every beat.
- Techniques (guitar and bass): hammer (hammer-on or pull-off into the next note on that string), slide (slide into the next note on that string), vibrato, bend (a full-tone bend), palmMute, letRing, dead (a muted, percussive note), tie (holds the previous note on that string; give it the same fret). Use them where a player would, not on every note.
- When improving, keep what makes the riff recognisable (its key, its rhythmic identity, its best idea) unless the guitarist asks for something different, and return the same number of bars.
- When writing something new, follow the guitarist's description, and fit the key, feel and tempo of the music that comes before it if there is any.
- The explanation is one or two plain sentences: what you wrote, or what you changed. No tab, no lists.`;

/** The user turn sent to Claude. */
export function riffUserMessage(req: RiffRequest): string {
  const bars = `exactly ${req.bars} bar${req.bars === 1 ? '' : 's'}`;
  const ask =
    req.mode === 'improve'
      ? `Improve the selected bars. Every part you write has ${bars}.\nWhat the guitarist asked: ${req.prompt.trim() || 'Make it better: more musical, more interesting to play, without losing its character.'}`
      : `Write something new of ${bars} per part.\nWhat the guitarist asked: ${req.prompt.trim()}`;
  return `${req.context}\n\n${ask}`;
}

// ---------- describing the song to Claude ----------

function trackText(t: DocTrack, i: number): string {
  if (t.kind === 'drums') return `Track ${i + 1} "${t.name}": drums (${DRUM_KIT.map((d) => d.id).join(', ')})`;
  const tuning = t.tuning.map((p, s) => `string ${s + 1} = ${pitchName(p)}`).join(', ');
  return `Track ${i + 1} "${t.name}": ${t.kind}, ${t.tuning.length} strings, sound "${t.sound}", tuning (highest string first): ${tuning}`;
}

function beatText(beat: DocBeat, track: DocTrack): string {
  const len = `1/${beat.duration}${beat.dotted ? ' dotted' : ''}${beat.triplet ? ' triplet' : ''}`;
  if (!beat.notes.length) return `rest ${len}`;
  const notes = beat.notes.map((n) => {
    if (track.kind === 'drums') return DRUM_KIT.find((d) => d.midi === track.tuning[n.string - 1])?.id ?? 'drum';
    const tech = RIFF_TECHNIQUES.filter((t) => n[t]);
    return `s${n.string}f${n.fret}${tech.length ? `(${tech.join(',')})` : ''}`;
  });
  return `${notes.join('+')} ${len}`;
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

/** One track's bars, as beat lists (and ASCII tab for guitar and bass). */
function showTrack(doc: SongDoc, track: number, from: number, to: number): string[] {
  const t = doc.tracks[track];
  const bars = doc.bars.slice(from, to + 1);
  const lines = [`Track ${track + 1} "${t.name}":`];
  bars.forEach((b, i) => lines.push(`Bar ${from + i + 1}${b.section ? ` [${b.section}]` : ''} (${b.ts[0]}/${b.ts[1]}): ${(b.tracks[track] ?? []).map((x) => beatText(x, t)).join(' | ')}`));
  if (t.kind !== 'drums') {
    const labels = t.tuning.map((p, i) => {
      const name = pitchName(p).replace(/-?\d+$/, '');
      return i === 0 && t.kind === 'guitar' ? name.toLowerCase() : name;
    });
    lines.push(asciiTab(bars, track, t.tuning.length, labels));
  }
  return lines;
}

/**
 * Builds the request for the bars selected (improve) or for something new at `at` (generate),
 * while the user is on `track`. The context lists every track, then shows the selected bars, or
 * the two bars with music just before the new riff, on every track that has notes there (and
 * always the user's own track).
 */
export function buildRiffRequest(
  doc: SongDoc,
  track: number,
  opts: { mode: 'improve'; range: BarRange; prompt: string } | { mode: 'generate'; at: number; bars: number; prompt: string },
): RiffRequest {
  const first = opts.mode === 'improve' ? normalizeRange(opts.range, doc).from : Math.min(Math.max(0, opts.at), doc.bars.length - 1);
  const ts = doc.bars[first].ts;
  const lines = [
    `Song: "${doc.title}". Tempo: ${tempoAt(doc, first)} BPM. Time signature: ${ts[0]}/${ts[1]}.`,
    '',
    `Tracks (the guitarist is working on track ${track + 1}):`,
    ...doc.tracks.map(trackText),
  ];
  const showRange = (title: string, from: number, to: number) => {
    lines.push('', title);
    doc.tracks.forEach((_, i) => {
      if (i === track || doc.bars.slice(from, to + 1).some((b) => hasNotes(b, i))) lines.push('', ...showTrack(doc, i, from, to));
    });
  };
  if (opts.mode === 'improve') {
    const r = normalizeRange(opts.range, doc);
    showRange(`The selected bars (${r.from + 1}–${r.to + 1}):`, r.from, r.to);
    return { mode: 'improve', prompt: opts.prompt, bars: r.to - r.from + 1, context: lines.join('\n') };
  }
  // Up to two bars with music just before the new riff, so it can follow on from them.
  let to = first - 1;
  while (to >= 0 && !doc.tracks.some((_, i) => hasNotes(doc.bars[to], i))) to--;
  if (to >= 0) showRange('What comes just before the new part:', Math.max(0, to - 1), to);
  else lines.push('', 'Nothing has been written before the new part yet.');
  return { mode: 'generate', prompt: opts.prompt, bars: Math.min(MAX_RIFF_BARS, Math.max(1, Math.round(opts.bars))), context: lines.join('\n') };
}

function tempoAt(doc: SongDoc, bar: number): number {
  for (let i = bar; i > 0; i--) if (doc.bars[i].tempo) return doc.bars[i].tempo!;
  return doc.tempo;
}

function hasNotes(bar: DocBar | undefined, track: number): boolean {
  return !!bar?.tracks[track]?.some((b) => b.notes.length);
}

// ---------- turning the answer into tracks and bars ----------

export interface RiffPart {
  /** The existing track it goes into, or null for a new track. */
  track: number | null;
  /** The track as it will be (the existing one, or the new one to add). */
  info: DocTrack;
  /** One voice per bar, each already the right length for the bar it goes into. */
  bars: DocBeat[][];
}

export interface RiffResult {
  parts: RiffPart[];
  explanation: string;
  /** Things that were corrected, for an honest message to the user ("2 bars were trimmed to fit"). */
  fixes: string[];
}

/** Where the riff goes: over the selected bars (improve) or from a bar on (generate). */
export interface RiffTarget {
  replace?: BarRange;
  at?: number;
}

const DURATION_SET = new Set<number>([1, 2, 4, 8, 16, 32]);
const KINDS = new Set<string>(RIFF_INSTRUMENTS);

/** A new track for an instrument: guitar and bass take the tuning of the song's first track of that kind. */
function newTrack(doc: SongDoc, kind: TrackKind, name: string): DocTrack {
  const same = doc.tracks.find((t) => t.kind === kind);
  const tuning = kind === 'drums' ? DRUM_TUNING : (same?.tuning ?? TUNING_PRESETS.find((p) => p.kind === kind)!.tuning);
  const fallback = kind === 'drums' ? 'Drums' : kind === 'bass' ? 'Bass' : `Guitar ${doc.tracks.filter((t) => t.kind === 'guitar').length + 1}`;
  return { name: name.trim().slice(0, 40) || fallback, kind, sound: same?.sound ?? DEFAULT_SOUND[kind], tuning: [...tuning] };
}

/**
 * Validates Claude's answer and makes it fit the song: each part goes to the existing track it
 * names when that is the same instrument, otherwise to a new track; notes on strings that don't
 * exist, frets out of range, unknown drums and second notes on one string are dropped; a tie gets
 * the fret of the note it holds (or stops being a tie); every part gets the same number of bars;
 * and each bar is cut or padded with rests to the length of the bar it will go into. Throws when
 * the answer has no usable notes at all.
 */
export function riffFromAnswer(raw: unknown, doc: SongDoc, target: RiffTarget, maxBars = MAX_RIFF_BARS): RiffResult {
  const r = raw as Partial<AiRiff> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.parts)) throw new Error('The assistant sent back something that is not a riff. Try again.');
  const fixes: string[] = [];
  let dropped = 0;
  let fitted = 0;

  // Which track each part goes to.
  const claimed = new Set<number>();
  let added = 0;
  const resolved: { track: number | null; info: DocTrack; raw: AiPart }[] = [];
  for (const p of r.parts.slice(0, MAX_RIFF_PARTS)) {
    if (!p || !KINDS.has(p.instrument) || !Array.isArray(p.bars)) continue;
    const existing = doc.tracks[p.track - 1];
    if (Number.isInteger(p.track) && existing && existing.kind === p.instrument && !claimed.has(p.track - 1)) {
      claimed.add(p.track - 1);
      resolved.push({ track: p.track - 1, info: existing, raw: p });
    } else if (doc.tracks.length + added < MAX_SONG_TRACKS) {
      added++;
      resolved.push({ track: null, info: newTrack(doc, p.instrument, typeof p.name === 'string' ? p.name : ''), raw: p });
    } else fixes.push(`A ${p.instrument} part was left out: the song already has ${MAX_SONG_TRACKS} tracks.`);
  }
  if (r.parts.length > MAX_RIFF_PARTS) fixes.push(`Only the first ${MAX_RIFF_PARTS} parts were kept.`);

  let count = Math.max(0, ...resolved.map((p) => p.raw.bars.length));
  if (count > maxBars) {
    fixes.push(`Only the first ${maxBars} bars were kept.`);
    count = maxBars;
  }
  const ts = planRiff(doc, existingTracks(resolved), target, count).map((s) => s.ts);

  const parts = resolved.map(({ track, info, raw: p }): RiffPart => {
    const drums = info.kind === 'drums';
    const strings = info.tuning.length;
    /** The fret last played on each string, for ties across beats and bars. */
    const lastFret = new Map<number, number>();
    const bars = Array.from({ length: count }, (_, bi) => {
      const beats: DocBeat[] = [];
      const bar = p.bars[bi];
      for (const b of Array.isArray(bar?.beats) ? bar.beats : []) {
        if (!b || !DURATION_SET.has(b.duration)) {
          dropped++;
          continue;
        }
        const notes: DocNote[] = [];
        for (const n of Array.isArray(b.notes) ? b.notes : []) {
          const note = drums ? drumNote(n) : stringNote(n, strings, lastFret);
          if (!note || notes.some((x) => x.string === note.string)) {
            dropped++;
            continue;
          }
          notes.push(note);
        }
        if (!drums) for (const n of notes) lastFret.set(n.string, n.fret);
        const beat: DocBeat = { duration: b.duration, notes: notes.sort((a, c) => a.string - c.string) };
        if (b.dotted) beat.dotted = true;
        if (b.triplet) beat.triplet = true;
        beats.push(beat);
      }
      const out = fitToLength(beats, barTicks(ts[bi]));
      // A bar the part didn't write at all is silence, not a mistake.
      if (out.changed && bar) fitted++;
      return out.beats;
    });
    return { track, info, bars };
  });

  if (!parts.some((p) => p.bars.some((v) => v.some((b) => b.notes.length)))) throw new Error('The assistant sent back a riff without any notes. Try again.');
  if (dropped) fixes.push(`${dropped} note${dropped === 1 ? '' : 's'} that didn't fit the instrument ${dropped === 1 ? 'was' : 'were'} left out.`);
  if (fitted) fixes.push(`${fitted} bar${fitted === 1 ? '' : 's'} didn't add up and ${fitted === 1 ? 'was' : 'were'} trimmed or filled with rests.`);
  return { parts, explanation: typeof r.explanation === 'string' ? r.explanation.trim() : '', fixes };
}

function drumNote(n: Partial<AiNote> | null): DocNote | null {
  const lane = n && typeof n.drum === 'string' ? drumLane(n.drum) : 0;
  return lane ? { string: lane, fret: 0 } : null;
}

function stringNote(n: Partial<AiNote> | null, strings: number, lastFret: Map<number, number>): DocNote | null {
  if (!n || !Number.isInteger(n.string) || n.string! < 1 || n.string! > strings || !Number.isInteger(n.fret) || n.fret! < 0 || n.fret! > RIFF_MAX_FRET) return null;
  const note: DocNote = { string: n.string!, fret: n.fret! };
  const tech = new Set(Array.isArray(n.techniques) ? n.techniques : []);
  for (const t of RIFF_TECHNIQUES) if (t !== 'tie' && t !== 'dead' && tech.has(t)) note[t] = true;
  if (tech.has('tie') && lastFret.has(note.string)) {
    note.tie = true;
    note.fret = lastFret.get(note.string)!;
  } else if (tech.has('dead')) note.dead = true;
  return note;
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

function existingTracks(parts: { track: number | null }[]): number[] {
  return parts.flatMap((p) => (p.track === null ? [] : [p.track]));
}

// ---------- putting the riff in the song ----------

interface Slot {
  /** An existing bar to write into, or null to insert a new bar before `insertAt`. */
  bar: number | null;
  insertAt: number;
  ts: [number, number];
}

/**
 * Where each riff bar goes. Improve: over the selected bars, then (if Claude wrote more) new bars
 * after them. Generate: from `at` on, into bars that are still empty on every existing track the
 * riff writes to, and as new bars as soon as a bar with notes comes up, so it never writes over
 * notes. Replaced bars keep their time signature; new bars take the one of the bar before them.
 */
function planRiff(doc: SongDoc, tracks: number[], target: RiffTarget, count: number): Slot[] {
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
    if (!inserting && i < doc.bars.length && !tracks.some((t) => hasNotes(doc.bars[i], t))) {
      slots.push({ bar: i, insertAt: i, ts: doc.bars[i].ts });
      i++;
    } else {
      inserting = true;
      slots.push({ bar: null, insertAt: i, ts: doc.bars[Math.max(0, Math.min(i, doc.bars.length) - 1)].ts });
    }
  }
  return slots;
}

export interface RiffEdit extends Edit {
  /** The bars the riff now occupies. */
  range: BarRange;
  /** Each part's track in the new document, and whether it was added. */
  written: { track: number; name: string; added: boolean }[];
}

/**
 * Writes the riff's parts into the song (see planRiff for where). New tracks are added at the end,
 * with rests everywhere else. Tracks the riff doesn't write keep their notes in replaced bars and
 * get rests in inserted bars. For improve, selected bars beyond the riff's length become rests on
 * the tracks it writes. The cursor goes to the start of the riff, on `cursor.track` when the riff
 * wrote it, else on the first part's track.
 */
export function applyRiff(doc: SongDoc, cursor: Cursor, target: RiffTarget, riff: RiffResult): RiffEdit {
  const count = Math.max(0, ...riff.parts.map((p) => p.bars.length));
  const slots = planRiff(doc, existingTracks(riff.parts), target, count);

  // Add the new tracks first: rests in every existing bar.
  const tracks = doc.tracks.slice();
  const written = riff.parts.map((p) => {
    if (p.track !== null) return { track: p.track, name: p.info.name, added: false };
    tracks.push({ ...p.info, tuning: [...p.info.tuning] });
    return { track: tracks.length - 1, name: p.info.name, added: true };
  });
  const addedCount = tracks.length - doc.tracks.length;
  const bars: DocBar[] = doc.bars.map((b) => (addedCount ? { ...b, tracks: [...b.tracks, ...Array.from({ length: addedCount }, () => restsFor(barTicks(b.ts)))] } : b));

  let inserted = 0;
  let firstBar = -1;
  let lastBar = -1;
  slots.forEach((slot, i) => {
    let at: number;
    if (slot.bar !== null) {
      at = slot.bar + inserted;
      bars[at] = { ...bars[at], tracks: bars[at].tracks.slice() };
    } else {
      at = slot.insertAt + inserted;
      bars.splice(at, 0, { ts: [slot.ts[0], slot.ts[1]], tracks: tracks.map(() => restsFor(barTicks(slot.ts))) });
      inserted++;
    }
    riff.parts.forEach((p, pi) => (bars[at].tracks[written[pi].track] = p.bars[i]));
    if (firstBar < 0) firstBar = at;
    lastBar = at;
  });
  if (target.replace) {
    const r = normalizeRange(target.replace, doc);
    for (let b = r.from + count; b <= r.to; b++) {
      const at = b + inserted;
      bars[at] = { ...bars[at], tracks: bars[at].tracks.slice() };
      for (const w of written) bars[at].tracks[w.track] = restsFor(barTicks(bars[at].ts));
      lastBar = at;
    }
  }
  const out: SongDoc = { ...doc, tracks, bars };
  const track = written.some((w) => w.track === cursor.track) ? cursor.track : (written[0]?.track ?? cursor.track);
  const keepString = track === cursor.track;
  const next = clampCursor(out, { ...cursor, track, bar: firstBar, beat: 0, string: keepString ? cursor.string : tracks[track].tuning.length });
  return {
    doc: out,
    cursor: next,
    // New tracks change every bar's layout: render from the start.
    changedBar: addedCount ? 0 : firstBar,
    range: { from: firstBar, to: lastBar },
    written,
  };
}

/** "Guitar, Bass (new track) and Drums (new track)": what the riff wrote, for the result message. */
export function describeWritten(written: RiffEdit['written'], doc: SongDoc): string {
  const names = written.map((w) => `${doc.tracks[w.track]?.name ?? w.name}${w.added ? ' (new track)' : ''}`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
}
