import type { NewSongInput, Song } from '../shared/types.ts';
import { parseYouTubeId } from '../shared/util.ts';
import { api, fileToBase64 } from './api.ts';
import { APP_NAME } from '../shared/brand.ts';
import { h, toast } from './dom.ts';

export async function renderLibrary(root: HTMLElement): Promise<void> {
  let songs: Song[] = [];
  let query = new URLSearchParams(location.hash.split('?')[1] ?? '').get('q') ?? '';
  let activeTag = '';

  const list = h('div.song-grid');
  const tagBar = h('div.tag-bar');
  const search = h('input.search', {
    type: 'search',
    placeholder: 'Search title, artist or tag…',
    value: query,
    oninput: (e: Event) => {
      query = (e.target as HTMLInputElement).value;
      draw();
    },
  });

  root.replaceChildren(
    h(
      'header.topbar',
      {},
      h('a.brand', { href: '#/' }, h('img.logo', { src: '/icon.svg', alt: '' }), APP_NAME),
      search,
      h('button.primary', { onclick: () => openSongDialog(null, reload) }, '+ Add song'),
    ),
    h('main.library', {}, tagBar, list),
  );
  search.focus();

  async function reload(): Promise<void> {
    try {
      songs = await api.listSongs();
    } catch (err) {
      list.replaceChildren(h('p.empty', {}, `Could not reach the Fretlane server: ${(err as Error).message}. Is "npm run dev" running?`));
      return;
    }
    draw();
  }

  function draw(): void {
    const tags = [...new Set(songs.flatMap((s) => s.tags))].sort();
    tagBar.replaceChildren(
      ...['', ...tags].map((t) =>
        h(
          'button.tag',
          {
            class: t === activeTag ? 'active' : '',
            onclick: () => {
              activeTag = t;
              draw();
            },
          },
          t || 'All',
        ),
      ),
    );
    const q = query.trim().toLowerCase();
    const shown = songs.filter(
      (s) =>
        (!activeTag || s.tags.includes(activeTag)) &&
        (!q || `${s.title} ${s.artist} ${s.tags.join(' ')}`.toLowerCase().includes(q)),
    );
    if (!shown.length) {
      list.replaceChildren(
        h('p.empty', {}, songs.length ? 'No songs match your search.' : 'Your library is empty. Click "+ Add song" to import a tab.'),
      );
      return;
    }
    list.replaceChildren(...shown.map((s) => songCard(s)));
  }

  function songCard(s: Song): HTMLElement {
    const thumb = s.youtubeId
      ? h('img.thumb', { src: `https://i.ytimg.com/vi/${s.youtubeId}/mqdefault.jpg`, alt: '', loading: 'lazy' })
      : h('div.thumb.no-video', {}, h('span', {}, '𝄞'));
    return h(
      'article.song-card',
      {},
      h('a.card-link', { href: `#/song/${encodeURIComponent(s.id)}` }, thumb, h('div.card-title', {}, s.title), h('div.card-artist', {}, s.artist)),
      h(
        'div.card-meta',
        {},
        h('span.badge', { title: s.tabSource }, s.tabFormat.toUpperCase()),
        s.youtubeId ? h('span.badge.yt', { title: 'Plays along with YouTube' }, '▶ YouTube') : h('span.badge', { title: 'Uses the built-in synthesizer' }, 'Synth'),
        s.syncPoints.length ? h('span.badge.synced', {}, `${s.syncPoints.length} sync`) : null,
        h('span.spacer'),
        h('button.icon', { title: 'Edit', onclick: () => openSongDialog(s, reload) }, '✎'),
        h(
          'button.icon.danger',
          {
            title: 'Delete',
            onclick: async () => {
              if (!confirm(`Delete "${s.title}" from your library?`)) return;
              await api.deleteSong(s.id);
              toast('Song deleted');
              await reload();
            },
          },
          '🗑',
        ),
      ),
    );
  }

  await reload();
}

/** Add (song = null) or edit an existing song. */
export function openSongDialog(song: Song | null, onSaved: (s: Song) => void | Promise<void>): void {
  const editing = !!song;
  const title = h('input', { name: 'title', placeholder: editing ? '' : 'Leave empty to use the tab title / file name', value: song?.title ?? '' });
  const artist = h('input', { name: 'artist', value: song?.artist ?? '' });
  const youtube = h('input', {
    name: 'youtube',
    placeholder: 'https://www.youtube.com/watch?v=…',
    value: song?.youtubeId ? `https://www.youtube.com/watch?v=${song.youtubeId}` : '',
  });
  const ytHint = h('small.hint');
  const checkYt = () => {
    const v = youtube.value.trim();
    ytHint.textContent = !v ? 'Optional. Without a video the tab plays with the built-in synthesizer.' : parseYouTubeId(v) ? `✓ Video id ${parseYouTubeId(v)}` : '⚠ Not a recognizable YouTube link';
  };
  youtube.addEventListener('input', checkYt);
  checkYt();
  const tags = h('input', { name: 'tags', placeholder: 'rock, practice, drop-d', value: song?.tags.join(', ') ?? '' });

  let source: 'file' | 'url' | 'text' = 'file';
  const fileInput = h('input', { type: 'file', accept: '.gp,.gp3,.gp4,.gp5,.gpx,.gp7,.xml,.musicxml,.mxl,.tex,.atex,.alphatex,.txt' });
  const urlInput = h('input', { type: 'url', placeholder: 'https://example.com/song.gp5  (direct link to a tab file or a page with a plain-text tab)' });
  const textInput = h('textarea', {
    rows: 10,
    placeholder: 'Paste a plain-text tab (e|---0---3---|…) or alphaTex here',
    spellcheck: false,
  });
  const panes = { file: fileInput, url: urlInput, text: textInput };
  const paneHost = h('div.source-pane', {}, fileInput);
  const tabs = h(
    'div.segmented',
    {},
    ...(['file', 'url', 'text'] as const).map((k) =>
      h(
        'button',
        {
          type: 'button',
          class: k === source ? 'active' : '',
          onclick: (e: Event) => {
            source = k;
            tabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
            (e.target as HTMLElement).classList.add('active');
            paneHost.replaceChildren(panes[k]);
          },
        },
        { file: 'Upload file', url: 'From URL', text: 'Paste text' }[k],
      ),
    ),
  );

  const status = h('p.form-status');
  const submit = h('button.primary', { type: 'submit' }, editing ? 'Save' : 'Add to library');
  const dialog = h('dialog.song-dialog');
  const form = h(
    'form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        submit.disabled = true;
        status.textContent = editing ? 'Saving…' : 'Importing tab…';
        try {
          const tagList = tags.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
          let saved: Song;
          if (song) {
            saved = await api.updateSong(song.id, { title: title.value, artist: artist.value, youtube: youtube.value, tags: tagList });
          } else {
            const input: NewSongInput = { title: title.value, artist: artist.value, youtube: youtube.value, tags: tagList };
            if (source === 'file') {
              const f = fileInput.files?.[0];
              if (!f) throw new Error('Choose a tab file first.');
              input.tabFile = { name: f.name, dataBase64: await fileToBase64(f) };
            } else if (source === 'url') {
              if (!urlInput.value.trim()) throw new Error('Enter the URL of a tab file.');
              input.tabUrl = urlInput.value.trim();
            } else {
              if (!textInput.value.trim()) throw new Error('Paste a tab first.');
              input.tabText = textInput.value;
            }
            saved = await api.addSong(input);
          }
          dialog.close();
          toast(editing ? 'Saved' : `Added "${saved.title}"`);
          await onSaved(saved);
        } catch (err) {
          status.textContent = (err as Error).message;
          status.classList.add('error');
        } finally {
          submit.disabled = false;
        }
      },
    },
    h('h2', {}, editing ? 'Edit song' : 'Add a song'),
    editing ? null : h('fieldset', {}, h('legend', {}, 'Tab'), tabs, paneHost, h('small.hint', {}, 'Guitar Pro 3–8 (.gp, .gp5, .gpx…), MusicXML, alphaTex, or plain-text tabs.')),
    h('label', {}, 'Title', title),
    h('label', {}, 'Artist', artist),
    h('label', {}, 'YouTube video', youtube, ytHint),
    h('label', {}, 'Tags (comma separated)', tags),
    status,
    h('div.dialog-actions', {}, h('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'), submit),
  );
  dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
