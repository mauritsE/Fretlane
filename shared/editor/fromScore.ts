/**
 * Reads an alphaTab score back into a SongDoc, so a written song can be opened in the editor again.
 * Songs written in Fretlane round-trip exactly. For other tabs it keeps what the editor can show
 * and lists what it had to leave out.
 */
import type * as alphaTab from '@coderline/alphatab';
import {
  DEFAULT_SOUND,
  DURATIONS,
  TUNING_PRESETS,
  clampTempo,
  drumLaneOf,
  drumTrack,
  type DocBar,
  type DocBeat,
  type DocNote,
  type DocTrack,
  type DurationValue,
  type SongDoc,
  type TrackKind,
} from './doc.ts';

/** General MIDI programs of the sounds the editor offers. */
const PROGRAMS: Record<number, string> = {
  24: 'acousticguitarnylon',
  25: 'acousticguitarsteel',
  27: 'electricguitarclean',
  28: 'electricguitarmuted',
  29: 'overdrivenguitar',
  30: 'distortionguitar',
  32: 'acousticbass',
  33: 'electricbassfinger',
  34: 'electricbasspick',
  35: 'fretlessbass',
  105: 'banjo',
};

export interface ScoreToDocResult {
  doc: SongDoc;
  /** Things the editor could not keep, in words. Empty for songs written in Fretlane. */
  dropped: string[];
}

export function scoreToDoc(score: alphaTab.model.Score): ScoreToDocResult {
  const dropped = new Set<string>();
  const usable = score.tracks.filter((t) => {
    const staff = t.staves[0];
    if (!staff) return false;
    if (staff.isPercussion) return true;
    if (!staff.tuning.length) {
      dropped.add(`track "${t.name}" (no tab staff)`);
      return false;
    }
    return true;
  });
  if (!usable.length) throw new Error('This tab has no track the editor can open.');

  const tracks: DocTrack[] = usable.map((t) => {
    const staff = t.staves[0];
    if (t.staves.length > 1) dropped.add('extra staves');
    if (staff.isPercussion) return drumTrack(t.name || 'Drums');
    const program = t.playbackInfo.program;
    const kind = kindOf(program, staff.tuning);
    if (staff.capo) dropped.add('capo');
    return { name: t.name, kind, sound: PROGRAMS[program] ?? DEFAULT_SOUND[kind], tuning: [...staff.tuning] };
  });

  let tempo = score.tempo;
  const bars: DocBar[] = score.masterBars.map((mb, i) => {
    const bar: DocBar = {
      ts: [mb.timeSignatureNumerator, mb.timeSignatureDenominator],
      tracks: usable.map((t) => readVoice(t.staves[0].bars[i], t, dropped)),
    };
    if (mb.isRepeatStart) bar.repeatStart = true;
    if (mb.repeatCount > 1) bar.repeatEnd = mb.repeatCount;
    const section = mb.section?.text || mb.section?.marker;
    if (section) bar.section = section;
    const change = mb.tempoAutomations[0]?.value;
    if (i > 0 && change && Math.round(change) !== Math.round(tempo)) bar.tempo = clampTempo(change);
    if (change) tempo = change;
    if (mb.alternateEndings) dropped.add('alternate endings');
    return bar;
  });

  return {
    doc: { title: score.title || 'Untitled', artist: score.artist || '', tempo: clampTempo(score.tempo), tracks, bars },
    dropped: [...dropped],
  };
}

/**
 * alphaTex doesn't say which instrument a stringed track is, so it is read from the sound and the
 * tuning: a preset tuning names its instrument, else bass programs or low tunings are bass.
 */
function kindOf(program: number, tuning: number[]): TrackKind {
  const preset = TUNING_PRESETS.find((p) => p.tuning.join() === tuning.join());
  if (preset && (preset.kind !== 'guitar' || program < 32 || program > 39)) return preset.kind;
  if (program === 105) return 'banjo';
  if ((program >= 32 && program <= 39) || (tuning.length <= 5 && Math.max(...tuning) <= 45)) return 'bass';
  return 'guitar';
}

function readVoice(bar: alphaTab.model.Bar | undefined, track: alphaTab.model.Track, dropped: Set<string>): DocBeat[] {
  if (!bar) return [];
  const stringCount = track.staves[0].tuning.length;
  const drums = track.staves[0].isPercussion;
  if (bar.voices.slice(1).some((v) => !v.isEmpty)) dropped.add('second voices');
  const out: DocBeat[] = [];
  for (const beat of bar.voices[0]?.beats ?? []) {
    if (beat.graceType) {
      dropped.add('grace notes');
      continue;
    }
    if (beat.isEmpty) continue;
    let duration = beat.duration as number;
    if (!DURATIONS.includes(duration as DurationValue)) {
      dropped.add('notes shorter than a 1/32 (made 1/32)');
      duration = duration < 1 ? 1 : 32;
    }
    if (beat.dots > 1) dropped.add('double dots');
    const tuplet = beat.hasTuplet ? `${beat.tupletNumerator}:${beat.tupletDenominator}` : '';
    if (tuplet && tuplet !== '3:2') dropped.add('tuplets other than triplets');
    const out1: DocBeat = { duration: duration as DurationValue, notes: [] };
    if (beat.dots) out1.dotted = true;
    if (tuplet === '3:2') out1.triplet = true;
    for (const n of beat.notes) {
      if (drums) {
        const gm = track.percussionArticulations[n.percussionArticulation]?.outputMidiNumber ?? n.percussionArticulation;
        const lane = drumLaneOf(gm);
        if (!lane) dropped.add('drums the editor\'s kit doesn\'t have');
        else if (!out1.notes.some((x) => x.string === lane)) out1.notes.push({ string: lane, fret: 0 });
        continue;
      }
      if (!n.isStringed) continue;
      const note: DocNote = { string: stringCount - n.string + 1, fret: n.fret };
      if (n.isTieDestination) note.tie = true;
      if (n.isDead) note.dead = true;
      if (n.isHammerPullOrigin) note.hammer = true;
      if (n.slideOutType) note.slide = true;
      if (n.vibrato) note.vibrato = true;
      if (n.hasBend) note.bend = true;
      if (n.isPalmMute) note.palmMute = true;
      if (n.isLetRing) note.letRing = true;
      if (n.isHarmonic) dropped.add('harmonics');
      out1.notes.push(note);
    }
    out1.notes.sort((a, b) => a.string - b.string);
    out.push(out1);
  }
  return out;
}
