import type { NewSongInput, Song } from '../shared/types.ts';
import { mediaLinkUrl, parseMediaLink } from '../shared/util.ts';
import { api, fileToBase64 } from './api.ts';
import { APP_NAME } from '../shared/brand.ts';
import { h, toast } from './dom.ts';
import { metronomeButton } from './metronome.ts';

type LibraryFilter = 'all' | 'favorites' | 'archive';
/** Remembered while the app is open, so "Back to library" returns to the same view. */
let filter: LibraryFilter = 'all';

export async function renderLibrary(root: HTMLElement): Promise<void> {
  let songs: Song[] = [];
  let query = new URLSearchParams(location.hash.split('?')[1] ?? '').get('q') ?? '';
  let activeTag = '';

  const list = h('div.song-grid');
  const viewBar = h('nav.view-bar', { 'aria-label': 'Library views' });
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
      metronomeButton(),
      h('button.primary', { onclick: () => openSongDialog(null, reload) }, '+ Add song'),
    ),
    h('main.library', {}, viewBar, tagBar, list),
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
    const active = songs.filter((s) => !s.archivedAt);
    const counts: Record<LibraryFilter, number> = {
      all: active.length,
      favorites: active.filter((s) => s.favorite).length,
      archive: songs.length - active.length,
    };
    viewBar.replaceChildren(
      ...(['all', 'favorites', 'archive'] as const).map((f) =>
        h(
          'button.view',
          {
            class: f === filter ? 'active' : '',
            'data-view': f,
            onclick: () => {
              filter = f;
              activeTag = '';
              draw();
            },
          },
          { all: 'All songs', favorites: '★ Favorites', archive: '✓ Archive' }[f],
          h('span.count', {}, String(counts[f])),
        ),
      ),
    );
    const inView = filter === 'archive' ? songs.filter((s) => s.archivedAt) : filter === 'favorites' ? active.filter((s) => s.favorite) : active;
    const tags = [...new Set(inView.flatMap((s) => s.tags))].sort();
    if (activeTag && !tags.includes(activeTag)) activeTag = '';
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
    const shown = inView.filter(
      (s) =>
        (!activeTag || s.tags.includes(activeTag)) &&
        (!q || `${s.title} ${s.artist} ${s.tags.join(' ')}`.toLowerCase().includes(q)),
    );
    if (filter === 'archive') shown.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
    if (!shown.length) {
      const empty =
        q || activeTag
          ? 'No songs match your search.'
          : filter === 'favorites'
            ? 'No favorites yet. Click the ☆ on a song to add it here.'
            : filter === 'archive'
              ? 'Nothing archived yet. When you have learned a song, click ✓ to move it here.'
              : 'Your library is empty. Click "+ Add song" to import a tab.';
      list.replaceChildren(h('p.empty', {}, empty));
      return;
    }
    list.replaceChildren(...shown.map((s) => songCard(s)));
  }

  async function patch(s: Song, change: { favorite?: boolean; archived?: boolean }, message: string): Promise<void> {
    try {
      await api.updateSong(s.id, change);
      toast(message);
      await reload(); // the server's order puts favorites first

    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  function songCard(s: Song): HTMLElement {
    const thumb = s.youtubeId
      ? h('img.thumb', { src: `https://i.ytimg.com/vi/${s.youtubeId}/mqdefault.jpg`, alt: '', loading: 'lazy' })
      : h('div.thumb.no-video', { style: `--hue: ${hue(s.id)}` }, h('span.initial', {}, [...s.title][0] ?? '𝄞'), h('span.clef', {}, '𝄞'));
    const level = LEVELS.find((l) => s.tags.includes(l));
    const archived = !!s.archivedAt;
    return h(
      'article.song-card',
      { class: archived ? 'archived' : '', 'data-title': s.title },
      h(
        'button.star',
        {
          class: s.favorite ? 'on' : '',
          title: s.favorite ? 'Remove from favorites' : 'Add to favorites',
          'aria-pressed': String(s.favorite),
          onclick: () => patch(s, { favorite: !s.favorite }, s.favorite ? `Removed "${s.title}" from favorites` : `★ "${s.title}" is a favorite`),
        },
        s.favorite ? '★' : '☆',
      ),
      h('a.card-link', { href: `#/song/${encodeURIComponent(s.id)}` }, thumb, h('div.card-title', {}, s.title), h('div.card-artist', {}, s.artist)),
      archived ? h('div.card-done', {}, `✓ Done ${new Date(s.archivedAt!).toLocaleDateString()}`) : null,
      h(
        'div.card-meta',
        {},
        level ? h('span.badge.level', { 'data-level': level }, level) : h('span.badge', { title: s.tabSource }, s.tabFormat.toUpperCase()),
        s.youtubeId
          ? h('span.badge.yt', { title: 'Plays along with YouTube' }, '▶ YouTube')
          : s.spotifyId
            ? h('span.badge.sp', { title: 'Plays along with Spotify' }, '♫ Spotify')
            : h('span.badge', { title: 'Uses the built-in synthesizer' }, 'Synth'),
        s.syncPoints.length ? h('span.badge.synced', {}, `${s.syncPoints.length} sync`) : null,
        h('span.spacer'),
        archived
          ? h('button.icon.restore', { title: 'Back to the library', onclick: () => patch(s, { archived: false }, `"${s.title}" is back in your library`) }, '↺')
          : h('button.icon.done', { title: 'Mark as done and move to the archive', onclick: () => patch(s, { archived: true }, `✓ "${s.title}" moved to the archive`) }, '✓'),
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

const LEVELS = ['beginner', 'intermediate', 'advanced'];

/** A stable colour per song for cards without a video thumbnail. */
function hue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Add (song = null) or edit an existing song. */
export function openSongDialog(song: Song | null, onSaved: (s: Song) => void | Promise<void>): void {
  const editing = !!song;
  const title = h('input', { name: 'title', placeholder: editing ? '' : 'Leave empty to use the tab title / file name', value: song?.title ?? '' });
  const artist = h('input', { name: 'artist', value: song?.artist ?? '' });
  const recording = h('input', {
    name: 'media',
    placeholder: 'https://www.youtube.com/watch?v=…  or  https://open.spotify.com/track/…',
    value: song ? mediaLinkUrl(song) : '',
  });
  const recordingHint = h('small.hint');
  const checkRecording = () => {
    const v = recording.value.trim();
    const { youtubeId, spotifyId } = parseMediaLink(v);
    recordingHint.textContent = !v
      ? 'Optional: a YouTube video or a Spotify track. Without one the tab plays with the built-in synthesizer.'
      : youtubeId
        ? `✓ YouTube video ${youtubeId}`
        : spotifyId
          ? `✓ Spotify track ${spotifyId}. Spotify can't slow down; log in to Spotify for full tracks instead of 30-second previews.`
          : '⚠ Not a recognizable YouTube video or Spotify track link';
  };
  recording.addEventListener('input', checkRecording);
  checkRecording();
  const tags = h('input', { name: 'tags', placeholder: 'rock, practice, drop-d', value: song?.tags.join(', ') ?? '' });

  let source: 'file' | 'url' | 'text' = 'file';
  const fileInput = h('input', { type: 'file', accept: '.gp,.gp3,.gp4,.gp5,.gpx,.gp7,.xml,.musicxml,.mxl,.tex,.atex,.alphatex,.txt' });
  const urlInput = h('input', { type: 'url', placeholder: 'https://example.com/song.gp5  (direct link to a tab file or a page with a plain-text tab)' });
  const textInput = h('textarea', {
    rows: 10,
    placeholder: 'Paste a plain-text tab (e|---0---3---|…) or alphaTex here',
    spellcheck: false,
    wrap: 'off', // tab lines only line up when they don't wrap
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
            saved = await api.updateSong(song.id, { title: title.value, artist: artist.value, media: recording.value, tags: tagList });
          } else {
            const input: NewSongInput = { title: title.value, artist: artist.value, media: recording.value, tags: tagList };
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
    h('label', {}, 'Recording (YouTube or Spotify)', recording, recordingHint),
    h('label', {}, 'Tags (comma separated)', tags),
    status,
    h('div.dialog-actions', {}, h('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'), submit),
  );
  dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
