import * as alphaTab from '@coderline/alphatab';
import type { Song } from '../shared/types.ts';
import {
  DEFAULT_SOUND,
  DRUM_TUNING,
  SOUNDS,
  TIME_SIGNATURES,
  TUNING_PRESETS,
  newSongDoc,
  parseTuning,
  pitchName,
  type DocTrack,
  type SongDoc,
  type TrackKind,
} from '../shared/editor/doc.ts';
import { docToTex } from '../shared/editor/tex.ts';
import { scoreToDoc } from '../shared/editor/fromScore.ts';
import { api } from './api.ts';
import { h, toast } from './dom.ts';
import { ensurePremium } from './premiumView.ts';

/** "✎ Write" in the library: start a new song in the editor (Premium). */
export function writeButton(): HTMLButtonElement {
  return h(
    'button.write-button',
    {
      title: 'Write your own song in the tab editor (Fretlane Premium)',
      onclick: async () => {
        if (await ensurePremium()) openNewSongDialog();
      },
    },
    '✎ Write',
  );
}

/** Tuning picker for one track: the presets for its kind, plus a custom tuning typed in. */
export function tuningField(kind: TrackKind, current?: number[]): { el: HTMLElement; value: () => number[] | null } {
  const presets = TUNING_PRESETS.filter((p) => p.kind === kind);
  const match = current && presets.find((p) => p.tuning.join() === current.join());
  const select = h(
    'select',
    { title: 'Tuning' },
    ...presets.map((p) => h('option', { value: p.id, selected: match ? match.id === p.id : p === presets[0] }, p.label)),
    // A drum kit has no tuning to type.
    kind === 'drums' ? null : h('option', { value: 'custom', selected: !!current && !match }, 'Custom…'),
  );
  const custom = h('input', {
    placeholder: kind === 'bass' ? 'Lowest string first, e.g. D A D G' : 'Lowest string first, e.g. C G C F A D',
    value: current && !match ? [...current].reverse().map(pitchName).join(' ') : '',
    class: current && !match ? '' : 'hidden',
  });
  select.addEventListener('change', () => custom.classList.toggle('hidden', select.value !== 'custom'));
  return {
    el: h('span.tuning-field', {}, select, custom),
    value: () => (select.value === 'custom' ? parseTuning(custom.value, kind) : (presets.find((p) => p.id === select.value)?.tuning ?? null)),
  };
}

export function soundSelect(kind: TrackKind, current?: string): HTMLSelectElement {
  const options = SOUNDS[kind];
  const value = current ?? DEFAULT_SOUND[kind];
  return h(
    'select',
    { title: 'Sound' },
    ...options.map((o) => h('option', { value: o.id, selected: o.id === value }, o.label)),
    options.some((o) => o.id === value) ? null : h('option', { value, selected: true }, value),
  );
}

export function openNewSongDialog(): void {
  const title = h('input', { name: 'title', placeholder: 'Untitled', required: true });
  const artist = h('input', { name: 'artist', placeholder: 'Me' });
  const tempo = h('input', { name: 'tempo', type: 'number', min: 20, max: 400, value: 120, style: 'width:6em' });
  const ts = h('select', { name: 'ts' }, ...TIME_SIGNATURES.map((t) => h('option', { value: t.join('/') }, t.join('/'))));
  const gtrOn = h('input', { type: 'checkbox', checked: true });
  const bassOn = h('input', { type: 'checkbox' });
  const drumsOn = h('input', { type: 'checkbox' });
  const gtrTuning = tuningField('guitar');
  const bassTuning = tuningField('bass');
  const gtrSound = soundSelect('guitar');
  const bassSound = soundSelect('bass');
  const status = h('p.form-status');
  const submit = h('button.primary', { type: 'submit' }, 'Start writing');
  const dialog = h('dialog.song-dialog.write-dialog');
  const form = h(
    'form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        status.classList.remove('error');
        try {
          const tracks: DocTrack[] = [];
          if (gtrOn.checked) {
            const tuning = gtrTuning.value();
            if (!tuning) throw new Error('Type the guitar tuning as note names, lowest string first (4 to 8 strings).');
            tracks.push({ name: 'Guitar', kind: 'guitar', sound: gtrSound.value, tuning });
          }
          if (bassOn.checked) {
            const tuning = bassTuning.value();
            if (!tuning) throw new Error('Type the bass tuning as note names, lowest string first (4 to 8 strings).');
            tracks.push({ name: 'Bass', kind: 'bass', sound: bassSound.value, tuning });
          }
          if (drumsOn.checked) tracks.push({ name: 'Drums', kind: 'drums', sound: DEFAULT_SOUND.drums, tuning: [...DRUM_TUNING] });
          if (!tracks.length) throw new Error('Pick at least one instrument.');
          const [num, den] = ts.value.split('/').map(Number) as [number, number];
          const doc = newSongDoc({ title: title.value, artist: artist.value, tempo: Number(tempo.value), ts: [num, den], tracks });
          submit.disabled = true;
          status.textContent = 'Creating…';
          const song = await createWrittenSong(doc);
          dialog.close();
          location.hash = `#/write/${encodeURIComponent(song.id)}`;
        } catch (err) {
          status.textContent = (err as Error).message;
          status.classList.add('error');
          submit.disabled = false;
        }
      },
    },
    h('h2', {}, '✎ New song'),
    h('label', {}, 'Title', title),
    h('label', {}, 'Artist', artist),
    h('div.row', {}, h('label', {}, 'Tempo (BPM)', tempo), h('label', {}, 'Time signature', ts)),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Instruments'),
      h('div.instrument-row', {}, h('label.check', {}, gtrOn, 'Guitar'), gtrTuning.el, gtrSound),
      h('div.instrument-row', {}, h('label.check', {}, bassOn, 'Bass'), bassTuning.el, bassSound),
      h('div.instrument-row', {}, h('label.check', {}, drumsOn, 'Drums')),
      h('small.hint', {}, 'Ukulele, mandolin, banjo and extra tracks can be added in the editor with + Track.'),
    ),
    status,
    h('div.dialog-actions', {}, h('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'), submit),
  );
  dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  title.focus();
}

/** Adds a written song to the library. */
export function createWrittenSong(doc: SongDoc, tags: string[] = ['written']): Promise<Song> {
  return api.addSong({ title: doc.title, artist: doc.artist, written: true, tabText: docToTex(doc), tags });
}

/**
 * Turns a tab that was not written in Fretlane (an import, a demo song) into a written copy the
 * editor can open. The original stays as it is. Says first what the editor can't keep.
 */
export async function makeEditableCopy(song: Song, score: alphaTab.model.Score): Promise<void> {
  if (!(await ensurePremium())) return;
  let result: ReturnType<typeof scoreToDoc>;
  try {
    result = scoreToDoc(score);
  } catch (err) {
    toast((err as Error).message, 'error');
    return;
  }
  const { doc, dropped } = result;
  const note = dropped.length ? `\n\nThe editor can't keep: ${dropped.join(', ')}. The original song keeps everything.` : '';
  if (!confirm(`Make an editable copy of "${song.title}"?${note}`)) return;
  try {
    const copy = await createWrittenSong({ ...doc, title: `${song.title} (my version)`, artist: song.artist }, [...new Set([...song.tags, 'written'])]);
    toast(`Added "${copy.title}"`);
    location.hash = `#/write/${encodeURIComponent(copy.id)}`;
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}
