/**
 * Turns a compact song description (melody as note names, chords as symbols) into a multi-track
 * alphaTex tab: lead guitar with computed fingerings, rhythm guitar, bass and optional drums.
 * Used by scripts/build-songbook.ts to generate the bundled songbook in demo/.
 *
 * Melody bar syntax, tokens separated by spaces:
 *   E4:4      E above middle C, quarter note      (durations 1 2 4 8 16)
 *   A3:8.     dotted eighth                       C5:8t   eighth-note triplet
 *   r:2       half rest                           ~:4     tie the previous notes on
 *   E3+B3:2   two notes at once (a dyad or chord)
 * A melody bar starting with "tex:" is copied verbatim as alphaTex (for fingerstyle pieces whose
 * fingering is written by hand); tests check its length with alphaTab.
 * Chord bar syntax: chord symbols that split the bar equally ("Am", "C G", "Am Am G" in 3/4);
 * "-" means no chord.
 */
import {
  BASS_STANDARD,
  BASS_STANDARD_TEX,
  GUITAR_STANDARD_TEX,
  QUARTER,
  chordFifth,
  chordRoot,
  chordShape,
  durationTicks,
  fingerSequence,
  parsePitch,
  pitchAtOrAbove,
  powerChord,
  splitTicks,
  type Fretted,
  type NoteValue,
} from './music.ts';

export type RhythmStyle = 'strum' | 'waltz' | 'arpeggio' | 'fingerpick' | 'rock' | 'oompah' | 'jig';
export type DrumStyle = 'rock' | 'folk' | 'waltz' | 'march' | 'jig' | 'shuffle';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export interface SongSpec {
  /** File name without extension. */
  id: string;
  title: string;
  /** Composer, or "Traditional". */
  artist: string;
  /** Where the tune comes from, shown as the subtitle. */
  origin: string;
  tempo: number;
  timeSignature: [number, number];
  /** alphaTex key signature, e.g. "aminor", "gmajor". */
  key: string;
  /** Pickup (anacrusis) bar before bar 1, melody syntax. */
  pickup?: string;
  melody: string[];
  /** One entry per melody bar. Not needed for solo pieces. */
  chords?: string[];
  rhythm: RhythmStyle;
  drums?: DrumStyle;
  /** Preferred fret for the melody (0 = open position). */
  position?: number;
  leadInstrument?: string;
  rhythmInstrument?: string;
  /** Solo piece: only the melody track (bass notes are part of the melody). */
  solo?: boolean;
  /** Tempo changes, keyed by 0-based melody bar. */
  tempoChanges?: Record<number, number>;
  difficulty: Difficulty;
  tags: string[];
}

interface MelodyEvent {
  pitches: number[] | 'rest' | 'tie';
  ticks: number;
  value: number;
  dotted: boolean;
  triplet: boolean;
}

export function parseMelodyBar(bar: string): MelodyEvent[] {
  return bar
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const m = /^([^:]+):(1|2|4|8|16|32)(\.)?(t)?$/.exec(tok);
      if (!m) throw new Error(`Bad melody token "${tok}"`);
      const value = Number(m[2]);
      const dotted = !!m[3];
      const triplet = !!m[4];
      const pitches: MelodyEvent['pitches'] = m[1] === 'r' ? 'rest' : m[1] === '~' ? 'tie' : m[1].split('+').map(parsePitch);
      return { pitches, ticks: durationTicks(value, dotted, triplet), value, dotted, triplet };
    });
}

function barTicks([num, den]: [number, number]): number {
  return (num * QUARTER * 4) / den;
}

function durTex(v: NoteValue & { triplet?: boolean }, ...effects: string[]): { dur: string; fx: string } {
  const fx = [v.dotted ? 'd' : '', v.triplet ? 'tu 3' : '', ...effects].filter(Boolean);
  return { dur: `:${v.value}`, fx: fx.length ? `{${fx.join(' ')}}` : '' };
}

/** Writes beats with `:dur` prefixes, only when the duration changes. */
class BarWriter {
  private parts: string[] = [];
  private lastDur = '';
  beat(notes: string, v: NoteValue & { triplet?: boolean }, ...effects: string[]): void {
    const { dur, fx } = durTex(v, ...effects);
    if (dur !== this.lastDur) {
      this.parts.push(dur);
      this.lastDur = dur;
    }
    this.parts.push(`${notes}${fx}`);
  }
  /** Rest (or held notes) for a length in ticks. */
  rest(ticks: number): void {
    for (const v of splitTicks(ticks)) this.beat('r', v);
  }
  toString(): string {
    return this.parts.join(' ');
  }
}

const noteTex = (n: Fretted): string => `${n.fret}.${n.string}`;
const beatTex = (ns: Fretted[]): string => (ns.length === 1 ? noteTex(ns[0]) : `(${ns.map(noteTex).join(' ')})`);
const tieTex = (ns: Fretted[]): string => (ns.length === 1 ? `-.${ns[0].string}` : `(${ns.map((n) => `-.${n.string}`).join(' ')})`);

function checkLength(label: string, got: number, want: number): void {
  if (Math.abs(got - want) > 0.5) {
    throw new Error(`${label}: ${got / QUARTER} quarter notes, expected ${want / QUARTER}`);
  }
}

const RAW = 'tex:';

function leadTrack(spec: SongSpec, fullBar: number): { bars: string[]; pickupTicks: number } {
  const source = [...(spec.pickup ? [spec.pickup] : []), ...spec.melody];
  const all = source.map((bar) => (bar.startsWith(RAW) ? null : parseMelodyBar(bar)));
  const pickupTicks = spec.pickup ? (all[0] ?? []).reduce((a, e) => a + e.ticks, 0) : 0;
  all.forEach((bar, i) => {
    if (!bar) return;
    const ticks = bar.reduce((a, e) => a + e.ticks, 0);
    if (spec.pickup && i === 0) {
      if (ticks >= fullBar) throw new Error(`${spec.id}: pickup must be shorter than a bar`);
    } else checkLength(`${spec.id} melody bar ${spec.pickup ? i : i + 1}`, ticks, fullBar);
  });
  const sounding = all.flatMap((bar) => bar ?? []).filter((e) => Array.isArray(e.pitches));
  const fingered = fingerSequence(
    sounding.map((e) => e.pitches as number[]),
    { position: spec.position },
  );
  let k = 0;
  let prev: Fretted[] | null = null;
  const bars = all.map((bar, i) => {
    if (!bar) return source[i].slice(RAW.length).trim();
    const w = new BarWriter();
    for (const e of bar) {
      if (e.pitches === 'rest') {
        w.beat('r', e);
        prev = null;
      } else if (e.pitches === 'tie') {
        if (!prev) throw new Error(`${spec.id}: tie without a note before it`);
        w.beat(tieTex(prev), e);
      } else {
        prev = fingered[k++];
        w.beat(beatTex(prev), e);
      }
    }
    return w.toString();
  });
  return { bars, pickupTicks };
}

interface ChordSlot {
  chord: string | null;
  ticks: number;
}

function chordSlots(spec: SongSpec, fullBar: number): ChordSlot[][] {
  const chords = spec.chords ?? [];
  if (chords.length !== spec.melody.length) {
    throw new Error(`${spec.id}: ${chords.length} chord bars for ${spec.melody.length} melody bars`);
  }
  return chords.map((bar, i) => {
    const names = bar.trim().split(/\s+/);
    const ticks = fullBar / names.length;
    if (ticks % meter(spec.timeSignature).beatTicks !== 0) {
      throw new Error(`${spec.id} chord bar ${i + 1}: chords must last whole beats`);
    }
    return names.map((n) => {
      if (n !== '-') chordShape(n); // throws for unknown chords
      return { chord: n === '-' ? null : n, ticks };
    });
  });
}

/** Beat and subdivision note values: x/4 beats split in two eighths, 6/8 beats in three. */
function meter([num, den]: [number, number]): { beat: NoteValue; sub: NoteValue; subs: number; beatTicks: number } {
  const compound = den === 8 && num % 3 === 0;
  if (compound) return { beat: { value: 4, dotted: true }, sub: { value: 8, dotted: false }, subs: 3, beatTicks: (QUARTER * 3) / 2 };
  return { beat: { value: den, dotted: false }, sub: { value: den * 2, dotted: false }, subs: 2, beatTicks: (QUARTER * 4) / den };
}

function rhythmBar(slots: ChordSlot[], spec: SongSpec): string {
  const w = new BarWriter();
  const m = meter(spec.timeSignature);
  for (const slot of slots) {
    if (!slot.chord) {
      w.rest(slot.ticks);
      continue;
    }
    const shape = chordShape(slot.chord);
    const bass = shape[0];
    const upper = shape.filter((n) => n.string <= 3);
    const beats = Math.max(1, Math.round(slot.ticks / m.beatTicks));
    // The chord name is shown above the first beat of each chord.
    let named = false;
    const fx = (): string[] => {
      if (named) return [];
      named = true;
      return [`ch "${slot.chord}"`];
    };
    switch (spec.rhythm) {
      case 'strum':
        for (let b = 0; b < beats; b++) w.beat(beatTex(shape), m.beat, ...fx());
        break;
      case 'waltz':
      case 'oompah': {
        const cycle = spec.rhythm === 'waltz' ? 3 : 2;
        for (let b = 0; b < beats; b++) w.beat(beatTex(b % cycle === 0 ? [bass] : upper), m.beat, ...fx());
        break;
      }
      case 'arpeggio': {
        const order = [bass, ...shape.slice(1).slice(-3)];
        const cycle = [0, 1, 2, 3, 2, 1];
        for (let i = 0; i < beats * m.subs; i++) w.beat(noteTex(order[cycle[i % cycle.length]] ?? bass), m.sub, ...fx());
        break;
      }
      case 'fingerpick': {
        const alt = shape[1] ?? bass;
        const top = upper.length ? upper : [bass];
        for (let b = 0; b < beats; b++) {
          w.beat(noteTex(b % 2 === 0 ? bass : alt), m.sub, ...fx());
          for (let s = 1; s < m.subs; s++) w.beat(noteTex(top[(b + s) % top.length]), m.sub);
        }
        break;
      }
      case 'rock': {
        // Palm-muted power chords; in alphaTex palm muting is a note effect.
        const pc = `(${powerChord(slot.chord).map((n) => `${noteTex(n)}{pm}`).join(' ')})`;
        for (let i = 0; i < beats * m.subs; i++) w.beat(pc, m.sub, ...fx());
        break;
      }
      case 'jig':
        for (let b = 0; b < beats; b++) {
          w.beat(noteTex(bass), m.sub, ...fx());
          for (let s = 1; s < m.subs; s++) w.beat(beatTex(upper), m.sub);
        }
        break;
    }
  }
  return w.toString();
}

interface BassEvent {
  pitch: number | null;
  ticks: number;
}

function bassBar(slots: ChordSlot[], spec: SongSpec): BassEvent[] {
  const out: BassEvent[] = [];
  const beat = meter(spec.timeSignature).beatTicks;
  for (const slot of slots) {
    if (!slot.chord) {
      out.push({ pitch: null, ticks: slot.ticks });
      continue;
    }
    const root = pitchAtOrAbove(chordRoot(slot.chord), 28); // E1 .. D#2
    const fifth = root + chordFifth(slot.chord);
    if (spec.rhythm === 'rock') {
      const n = Math.round(slot.ticks / (QUARTER / 2));
      for (let i = 0; i < n; i++) out.push({ pitch: root, ticks: QUARTER / 2 });
    } else if (slot.ticks >= 2 * beat && slot.ticks % (2 * beat) === 0 && spec.timeSignature[0] !== 3) {
      out.push({ pitch: root, ticks: slot.ticks / 2 }, { pitch: fifth, ticks: slot.ticks / 2 });
    } else {
      out.push({ pitch: root, ticks: slot.ticks });
    }
  }
  return out;
}

const DRUM = { kick: 36, snare: 38, hat: 42, ride: 51, crash: 49, stick: 37 };

function drumBar(style: DrumStyle, ts: [number, number], crash: boolean): string {
  const w = new BarWriter();
  const [num, den] = ts;
  const q: NoteValue = { value: 4, dotted: false };
  const e8: NoteValue = { value: 8, dotted: false };
  const hit = (...n: number[]) => (n.length === 1 ? String(n[0]) : `(${n.join(' ')})`);
  const first = (n: number[]) => (crash ? [...n.filter((x) => x !== DRUM.hat), DRUM.crash] : n);
  if (den === 8) {
    // 6/8 or 9/8 jig feel: kick on 1, snare on 4, hats in between.
    for (let i = 0; i < num; i++) {
      const n = i === 0 ? first([DRUM.kick, DRUM.hat]) : i % 3 === 0 ? [DRUM.snare, DRUM.hat] : [DRUM.hat];
      w.beat(hit(...n), e8);
    }
    return w.toString();
  }
  for (let b = 0; b < num; b++) {
    const back = b % 2 === 1;
    switch (style) {
      case 'rock':
      case 'shuffle':
        w.beat(hit(...(b === 0 ? first([DRUM.kick, DRUM.hat]) : back ? [DRUM.snare, DRUM.hat] : [DRUM.kick, DRUM.hat])), e8);
        w.beat(hit(...(b === 2 && num === 4 ? [DRUM.kick, DRUM.hat] : [DRUM.hat])), e8);
        break;
      case 'folk':
        w.beat(hit(...(b === 0 ? first([DRUM.kick, DRUM.hat]) : back ? [DRUM.stick, DRUM.hat] : [DRUM.kick, DRUM.hat])), q);
        break;
      case 'waltz':
        w.beat(hit(...(b === 0 ? first([DRUM.kick, DRUM.ride]) : [DRUM.ride])), q);
        break;
      case 'march':
      case 'jig':
        if (b === 0) w.beat(hit(...first([DRUM.kick, DRUM.snare])), q);
        else {
          w.beat(hit(DRUM.snare), e8);
          w.beat(hit(DRUM.snare), e8);
        }
        break;
    }
  }
  return w.toString();
}

export function songSpecToAlphaTex(spec: SongSpec): string {
  const fullBar = barTicks(spec.timeSignature);
  const { bars: lead, pickupTicks } = leadTrack(spec, fullBar);

  const esc = (t: string) => t.replace(/"/g, "'");
  const head = `\\ts (${spec.timeSignature[0]} ${spec.timeSignature[1]}) \\ks ${spec.key}${spec.pickup ? ' \\ac' : ''}`;
  const lines: string[] = [
    `\\title "${esc(spec.title)}"`,
    `\\subtitle "${esc(spec.origin)}"`,
    `\\artist "${esc(spec.artist)}"`,
    `\\music "${esc(spec.artist)}"`,
    `\\tab "Fretlane songbook arrangement (public domain melody)"`,
    `\\tempo ${spec.tempo}`,
    '',
    '\\track "Melody"',
    '\\staff {score tabs}',
    `\\tuning ${GUITAR_STANDARD_TEX}`,
    `\\instrument ${spec.leadInstrument ?? 'acousticguitarsteel'}`,
    ...lead.map((bar, i) => {
      const bpm = spec.tempoChanges?.[spec.pickup ? i - 1 : i];
      const meta = [i === 0 ? head : '', bpm && i > 0 ? `\\tempo ${bpm}` : ''].filter(Boolean).join(' ');
      return `${meta ? `${meta} ` : ''}${bar} |`;
    }),
  ];
  if (spec.solo) return finish(lines);

  const slots = chordSlots(spec, fullBar);
  const pickupRest = () => {
    const w = new BarWriter();
    w.rest(pickupTicks);
    return w.toString();
  };
  const withPickup = (bars: string[]) => (spec.pickup ? [pickupRest(), ...bars] : bars);

  const rhythm = withPickup(slots.map((sl) => rhythmBar(sl, spec)));

  const bassEvents = slots.map((sl) => bassBar(sl, spec));
  const bassFingers = fingerSequence(
    bassEvents.flat().filter((e) => e.pitch !== null).map((e) => [e.pitch as number]),
    { tuning: BASS_STANDARD, maxFret: 12 },
  );
  let bi = 0;
  const bass = withPickup(
    bassEvents.map((bar) => {
      const w = new BarWriter();
      for (const e of bar) {
        if (e.pitch === null) {
          w.rest(e.ticks);
          continue;
        }
        const f = bassFingers[bi++];
        splitTicks(e.ticks).forEach((v, j) => w.beat(j === 0 ? beatTex(f) : tieTex(f), v));
      }
      return w.toString();
    }),
  );

  lines.push(
    '',
    '\\track "Rhythm guitar"',
    '\\staff {score tabs}',
    `\\tuning ${GUITAR_STANDARD_TEX}`,
    `\\instrument ${spec.rhythmInstrument ?? 'acousticguitarnylon'}`,
    ...rhythm.map((bar) => `${bar} |`),
    '',
    '\\track "Bass"',
    '\\staff {score tabs}',
    `\\tuning ${BASS_STANDARD_TEX}`,
    '\\instrument electricbassfinger',
    ...bass.map((bar) => `${bar} |`),
  );
  if (spec.drums) {
    const drums = withPickup(spec.melody.map((_, i) => drumBar(spec.drums!, spec.timeSignature, i === 0)));
    lines.push('', '\\track "Drums"', '\\instrument percussion', '\\staff {score}', ...drums.map((bar) => `${bar} |`));
  }
  return finish(lines);
}

/** alphaTex does not want a bar separator after the last bar of a track. */
function finish(lines: string[]): string {
  return `${lines.join('\n').replace(/ \|(\n\n|$)/g, '$1')}\n`;
}
