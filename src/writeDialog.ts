import * as alphaTab from '@coderline/alphatab';
import type { Song } from '../shared/types.ts';
import {
  DEFAULT_SOUND,
  DRUM_TUNING,
  SOUNDS,
  TIME_SIGNATURES,
  MAX_STRINGS,
  MIN_STRINGS,
  TUNING_PRESETS,
  addLowString,
  findTuningPreset,
  newSongDoc,
  parseTuning,
  pitchName,
  removeLowString,
  shiftTuning,
  stringPitchRange,
  type DocTrack,
  type TuningPreset,
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

/**
 * Tuning picker for one track: a preset, then one note per string (lowest first, as guitarists
 * say it) that can be changed on its own or typed as text, the whole tuning moved a half step at
 * a time, and strings added below or taken off. Any change that matches a preset selects it.
 */
export function tuningField(kind: TrackKind, current?: number[]): { el: HTMLElement; value: () => number[] } {
  const presets = TUNING_PRESETS.filter((p) => p.kind === kind);
  let tuning = [...(current ?? presets[0].tuning)];
  if (kind === 'drums') return { el: h('span.tuning-field'), value: () => [...tuning] };

  const [lo, hi] = stringPitchRange(kind);
  const custom = h('option', { value: 'custom' }, 'Custom');
  const counts = [...new Set(presets.map((p) => p.tuning.length))];
  const option = (p: TuningPreset) => h('option', { value: p.id }, p.label);
  const select = h(
    'select',
    { title: 'Tuning preset' },
    // Group by number of strings when the instrument has more than one (guitar, bass).
    counts.length > 1
      ? counts.map((n) => h('optgroup', { label: `${n} strings` }, ...presets.filter((p) => p.tuning.length === n).map(option)))
      : presets.map(option),
    custom,
  );
  const strings = h('span.tuning-strings');
  // The same tuning as text, for typing one in ("A E A D F# B" is drop A).
  const typed = h('input.tuning-typed', { title: 'Or type the notes, lowest string first', 'aria-label': 'Tuning as note names, lowest string first', spellcheck: false });
  typed.addEventListener('input', () => {
    const parsed = parseTuning(typed.value, kind);
    typed.classList.toggle('invalid', !parsed);
    if (parsed) set(parsed, false);
  });
  typed.addEventListener('blur', () => set(tuning));
  const button = (label: string, title: string, onclick: () => void) => h('button.small', { type: 'button', title, 'aria-label': title, onclick }, label);
  const down = button('▼ ½', 'Tune every string a half step down', () => set(shiftTuning(tuning, -1, kind)));
  const up = button('▲ ½', 'Tune every string a half step up', () => set(shiftTuning(tuning, 1, kind)));
  const add = button('+ string', 'Add a lower string (a fourth below)', () => set(addLowString(tuning, kind)));
  const remove = button('− string', 'Take off the lowest string', () => set(removeLowString(tuning)));

  function set(next: number[], retype = true): void {
    tuning = next;
    if (retype) {
      typed.value = [...tuning].reverse().map((p) => pitchName(p).replace(/-?\d+$/, '')).join(' ');
      typed.classList.remove('invalid');
    }
    const preset = findTuningPreset(kind, tuning);
    custom.hidden = !!preset;
    select.value = preset?.id ?? 'custom';
    // Lowest string first, left to right; the tuning itself is stored highest string first.
    strings.replaceChildren(
      ...[...tuning].reverse().map((pitch, i) => {
        const index = tuning.length - 1 - i;
        const pick = h(
          'select.string-pitch',
          { title: `String ${index + 1}`, 'aria-label': `String ${index + 1}` },
          ...Array.from({ length: hi - lo + 1 }, (_, k) => hi - k).map((m) => h('option', { value: m, selected: m === pitch }, pitchName(m))),
        );
        pick.addEventListener('change', () => set(tuning.map((p, j) => (j === index ? Number(pick.value) : p))));
        return pick;
      }),
    );
    down.disabled = tuning.some((p) => p - 1 < lo);
    up.disabled = tuning.some((p) => p + 1 > hi);
    add.disabled = tuning.length >= MAX_STRINGS;
    remove.disabled = tuning.length <= MIN_STRINGS;
  }
  select.addEventListener('change', () => {
    const preset = presets.find((p) => p.id === select.value);
    if (preset) set([...preset.tuning]);
  });
  set(tuning);
  return {
    el: h('span.tuning-field', {}, select, h('span.tuning-row', {}, strings, typed), h('span.tuning-row', {}, h('span.tuning-buttons', {}, down, up, add, remove))),
    value: () => [...tuning],
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
            tracks.push({ name: 'Guitar', kind: 'guitar', sound: gtrSound.value, tuning: gtrTuning.value() });
          }
          if (bassOn.checked) {
            tracks.push({ name: 'Bass', kind: 'bass', sound: bassSound.value, tuning: bassTuning.value() });
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
