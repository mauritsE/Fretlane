/**
 * Checks Claude's riff for what a guitarist would hear as wrong or couldn't play: bars that don't add
 * up, strings the instrument doesn't have, stretches no hand makes, drum hits no drummer has the
 * limbs for, and parts that wander out of the song's key. The server sends the problems back to
 * Claude for one corrected answer (askClaude in server/assistant.ts).
 *
 * No imports, because the website has a copy (src/lib/riffCheck.ts in mauritsE/fretlane-sync-magic,
 * formatted by Prettier): keep the two in step.
 */

/**
 * What the app knows about the song that the checks need, sent with the request. Optional: an
 * older app sends none, and then only the checks that don't need it run.
 */
export interface RiffCheckContext {
  /** The song's key, estimated from its notes; null when there are too few notes to tell. */
  key: { name: string; pitchClasses: number[] } | null;
  /** Length of each bar the riff fills, in quarter notes (4 in 4/4, 3 in 3/4, 3 in 6/8). */
  barQuarters: number[];
  /** The song's tracks in order (track 1 first): MIDI pitch per string, highest string first. */
  tracks: { kind: string; tuning: number[] }[];
}

/** Tunings for new tracks, as the app gives them (highest string first). */
const NEW_TUNING = { guitar: [64, 59, 55, 50, 45, 40], bass: [43, 38, 33, 28] };
const MAX_FRET = 24;
/** Widest span of fretted notes in one chord, in frets (2 to 7 is a span of 5). */
const MAX_STRETCH = 5;
/** A drummer has two hands and two feet. */
const MAX_DRUM_HITS = 4;
const HI_HATS = ['openHiHat', 'closedHiHat', 'pedalHiHat'];
/** A part is out of key when more than this share of its notes is outside the key's scale. */
const OUT_OF_KEY = 0.3;
/** Fewer notes than this say too little about the key to complain. */
const MIN_KEY_NOTES = 8;
const MAX_PROBLEMS = 12;

/** Checks the context's shape and size. Returns an error message, or null when it is fine. */
export function riffCheckProblem(ctx: unknown, bars: number): string | null {
  const c = ctx as Partial<RiffCheckContext> | null;
  const ints = (a: unknown, max: number, lo: number, hi: number) =>
    Array.isArray(a) && a.length <= max && a.every((n) => Number.isInteger(n) && n >= lo && n <= hi);
  if (!c || typeof c !== 'object') return 'check must be an object.';
  if (c.key !== null && (typeof c.key !== 'object' || typeof c.key?.name !== 'string' || c.key.name.length > 40 || !ints(c.key.pitchClasses, 12, 0, 11))) return 'check.key is not a key.';
  if (!Array.isArray(c.barQuarters) || c.barQuarters.length > bars || !c.barQuarters.every((q) => typeof q === 'number' && q > 0 && q <= 32)) return 'check.barQuarters must give each bar its length.';
  if (!Array.isArray(c.tracks) || c.tracks.length > 32 || !c.tracks.every((t) => t && typeof t.kind === 'string' && t.kind.length <= 20 && ints(t.tuning, 16, 0, 127))) return 'check.tracks must give each track its tuning.';
  return null;
}

interface Note {
  string?: unknown;
  fret?: unknown;
  drum?: unknown;
  techniques?: unknown;
}
interface Beat {
  duration?: unknown;
  dotted?: unknown;
  triplet?: unknown;
  notes?: unknown;
}

/** How long a beat lasts, in quarter notes. */
function quarters(b: Beat): number {
  const d = typeof b.duration === 'number' && b.duration > 0 ? b.duration : 4;
  return (4 / d) * (b.dotted === true ? 1.5 : 1) * (b.triplet === true ? 2 / 3 : 1);
}

const num = (q: number) => String(Math.round(q * 100) / 100);

/**
 * The problems in one answer, one plain sentence each, most important first; empty when it's fine.
 * `bars` is how many bars each part should have.
 */
export function riffProblems(raw: unknown, bars: number, ctx?: RiffCheckContext): string[] {
  const parts = (raw as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(parts)) return [];
  const out: string[] = [];
  const add = (s: string) => {
    if (out.length < MAX_PROBLEMS) out.push(s);
  };
  parts.slice(0, 4).forEach((part: { track?: unknown; instrument?: unknown; name?: unknown; bars?: unknown }, pi) => {
    const instrument = typeof part?.instrument === 'string' ? part.instrument : 'guitar';
    const name = typeof part?.name === 'string' && part.name.trim() ? part.name.trim() : `Part ${pi + 1}`;
    const drums = instrument === 'drums';
    const existing = typeof part?.track === 'number' && part.track > 0 ? ctx?.tracks[part.track - 1] : undefined;
    const tuning: number[] = existing && existing.kind !== 'drums' ? existing.tuning : instrument === 'bass' ? NEW_TUNING.bass : NEW_TUNING.guitar;
    const partBars = Array.isArray(part?.bars) ? (part.bars as { beats?: unknown }[]) : [];
    if (partBars.length !== bars) add(`${name} has ${partBars.length} bar${partBars.length === 1 ? '' : 's'}; every part needs exactly ${bars}.`);
    let inKey = 0;
    let outOfKey = 0;
    partBars.slice(0, bars).forEach((bar, bi) => {
      const beats = Array.isArray(bar?.beats) ? (bar.beats as Beat[]) : [];
      const where = `${name}, bar ${bi + 1}`;
      const expected = ctx?.barQuarters[bi];
      if (expected !== undefined) {
        const total = beats.reduce((n, b) => n + quarters(b), 0);
        if (Math.abs(total - expected) > 1e-6) add(`${where} adds up to ${num(total)} quarter notes; it needs exactly ${num(expected)}.`);
      }
      for (const beat of beats) {
        const notes = Array.isArray(beat?.notes) ? (beat.notes as Note[]) : [];
        if (drums) {
          const hits = notes.map((n) => n?.drum);
          if (hits.length > MAX_DRUM_HITS) add(`${where}: ${hits.length} drum hits at once; a drummer can play at most ${MAX_DRUM_HITS}.`);
          if (hits.filter((h) => HI_HATS.includes(h as string)).length > 1) add(`${where}: two hi-hat sounds at once (${hits.filter((h) => HI_HATS.includes(h as string)).join(' and ')}); the hi-hat is either open or closed.`);
          if (new Set(hits).size < hits.length) add(`${where}: the same drum twice on one beat.`);
          continue;
        }
        const strings = notes.map((n) => n?.string);
        const bad = notes.filter((n) => !Number.isInteger(n?.string) || (n.string as number) < 1 || (n.string as number) > tuning.length);
        if (bad.length) add(`${where}: string ${bad.map((n) => String(n?.string)).join(', ')} doesn't exist on this ${tuning.length}-string ${instrument === 'bass' ? 'bass' : 'guitar'} (1 is the highest string).`);
        if (notes.some((n) => !Number.isInteger(n?.fret) || (n.fret as number) < 0 || (n.fret as number) > MAX_FRET)) add(`${where}: frets go from 0 to ${MAX_FRET}.`);
        if (new Set(strings).size < strings.length) add(`${where}: two notes on the same string at once; a string plays one note at a time.`);
        const fretted = notes.map((n) => n?.fret).filter((f): f is number => typeof f === 'number' && f > 0);
        if (fretted.length > 1 && Math.max(...fretted) - Math.min(...fretted) > MAX_STRETCH) add(`${where}: a chord from fret ${Math.min(...fretted)} to fret ${Math.max(...fretted)} is too wide a stretch to play.`);
        if (ctx?.key) {
          for (const n of notes) {
            const open = tuning[(n?.string as number) - 1];
            const tech = Array.isArray(n?.techniques) ? n.techniques : [];
            if (open === undefined || typeof n.fret !== 'number' || tech.includes('dead')) continue;
            if (ctx.key.pitchClasses.includes((((open + n.fret) % 12) + 12) % 12)) inKey++;
            else outOfKey++;
          }
        }
      }
    });
    const total = inKey + outOfKey;
    if (ctx?.key && total >= MIN_KEY_NOTES && outOfKey / total > OUT_OF_KEY) {
      add(`${name}: ${outOfKey} of ${total} notes are outside ${ctx.key.name}, the song's key. Keep to the key unless the guitarist asked for a change.`);
    }
  });
  return out;
}

/** The follow-up turn that asks Claude to correct its answer. */
export function riffFixPrompt(problems: string[]): string {
  return [
    'These problems were found in your answer:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Send the whole answer again with these fixed, changing as little else as possible. If something listed was what the guitarist asked for (for example a different key), keep it.',
  ].join('\n');
}
