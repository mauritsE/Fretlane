/**
 * Turns a SongDoc into alphaTex. The editor renders and plays this through alphaTab, and the
 * library stores it as the song's tab file, so a written song plays in the normal player too.
 */
import { isDrums, pitchName, type DocBar, type DocBeat, type DocNote, type DocTrack, type SongDoc } from './doc.ts';

export function docToTex(doc: SongDoc): string {
  const lines = [`\\title ${quote(doc.title)}`, `\\artist ${quote(doc.artist)}`, `\\tempo ${doc.tempo}`];
  doc.tracks.forEach((track, ti) => {
    lines.push('', `\\track ${quote(track.name || `Track ${ti + 1}`)}`);
    // Drums are written on a drum staff: notes are GM percussion numbers, not fret.string.
    if (isDrums(track)) lines.push('\\staff {score}', '\\instrument percussion');
    else lines.push('\\staff {tabs}', `\\tuning (${track.tuning.map((p) => pitchName(p).toLowerCase()).join(' ')})`, `\\instrument ${track.sound}`);
    let ts = '';
    doc.bars.forEach((bar, bi) => {
      const meta: string[] = [];
      const barTs = `${bar.ts[0]} ${bar.ts[1]}`;
      if (barTs !== ts) meta.push(`\\ts (${barTs})`);
      // A drum staff gets the percussion clef (alphaTab's default is treble).
      if (bi === 0 && isDrums(track)) meta.push('\\clef neutral');
      ts = barTs;
      if (bar.repeatStart) meta.push('\\ro');
      if (bar.repeatEnd && bar.repeatEnd > 1) meta.push(`\\rc ${bar.repeatEnd}`);
      // Sections and tempo changes belong to the bar, not the track: write them once.
      if (ti === 0 && bar.section) meta.push(`\\section ${quote(bar.section)}`);
      if (ti === 0 && bar.tempo && bi > 0) meta.push(`\\tempo ${bar.tempo}`);
      lines.push(`${[...meta, ...barBeats(bar, ti).map((b) => beatTex(b, track))].join(' ')} |`);
    });
  });
  return `${lines.join('\n')}\n`;
}

function barBeats(bar: DocBar, track: number): DocBeat[] {
  const beats = bar.tracks[track] ?? [];
  // alphaTab needs at least one beat per bar.
  return beats.length ? beats : [{ duration: 1, notes: [] }];
}

function beatTex(beat: DocBeat, track: DocTrack): string {
  const effects = [beat.dotted ? 'd' : '', beat.triplet ? 'tu 3' : ''].filter(Boolean);
  const suffix = `.${beat.duration}${effects.length ? `{${effects.join(' ')}}` : ''}`;
  if (!beat.notes.length) return `r${suffix}`;
  if (isDrums(track)) {
    // Always in brackets: a lone "42.8" would read as fret 42 on string 8.
    const hits = beat.notes.map((n) => track.tuning[n.string - 1]).filter((gm) => gm !== undefined);
    return hits.length ? `(${hits.join(' ')})${suffix}` : `r${suffix}`;
  }
  const notes = beat.notes.map(noteTex);
  return `${notes.length === 1 ? notes[0] : `(${notes.join(' ')})`}${suffix}`;
}

function noteTex(note: DocNote): string {
  const effects = [
    note.hammer ? 'h' : '',
    note.slide ? 'sl' : '',
    note.vibrato ? 'v' : '',
    note.bend ? 'b (0 4)' : '',
    note.palmMute ? 'pm' : '',
    note.letRing ? 'lr' : '',
  ].filter(Boolean);
  const fret = note.tie ? '-' : note.dead ? 'x' : String(note.fret);
  return `${fret}.${note.string}${effects.length ? `{${effects.join(' ')}}` : ''}`;
}

function quote(text: string): string {
  return `"${text.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, ' ')}"`;
}
