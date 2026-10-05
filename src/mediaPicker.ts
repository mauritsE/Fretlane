import { formatDuration, type MediaSearchResult, type MediaSource } from '../shared/mediaSearch.ts';
import { api } from './api.ts';
import { h } from './dom.ts';

/** Remembered while the app is open, so the next song searches the same service. */
let lastSource: MediaSource = 'youtube';

/**
 * Search YouTube or Spotify from the song dialog and pick a recording. Results come back ranked
 * so the studio recording is on top; clicking one hands it to `onPick`.
 */
export function mediaPicker(initialQuery: string, onPick: (r: MediaSearchResult) => void): HTMLElement {
  let source = lastSource;
  let seq = 0; // ignores answers to searches the user has already replaced

  const query = h('input.picker-query', {
    type: 'search',
    value: initialQuery,
    placeholder: 'Artist and song title',
    'aria-label': 'Search for a recording',
    onkeydown: (e: Event) => {
      if ((e as KeyboardEvent).key !== 'Enter') return;
      e.preventDefault(); // Enter searches; it must not submit the song form
      void run();
    },
  });
  const sourceButtons = (['youtube', 'spotify'] as const).map((k) =>
    h(
      'button',
      {
        type: 'button',
        class: k === source ? 'active' : '',
        'data-source': k,
        onclick: () => {
          source = lastSource = k;
          sourceButtons.forEach((b) => b.classList.toggle('active', b.dataset.source === k));
          void run();
        },
      },
      k === 'youtube' ? 'YouTube' : 'Spotify',
    ),
  );
  const results = h('div.picker-results', { role: 'list' });
  const root = h(
    'div.media-picker',
    {},
    h('div.picker-bar', {}, h('div.segmented', {}, ...sourceButtons), query, h('button', { type: 'button', onclick: () => void run() }, 'Search')),
    results,
  );

  async function run(): Promise<void> {
    const q = query.value.trim();
    const mine = ++seq;
    if (!q) {
      results.replaceChildren(h('p.hint', {}, 'Type the artist and song title.'));
      return;
    }
    results.replaceChildren(h('p.hint', {}, `Searching ${source === 'youtube' ? 'YouTube' : 'Spotify'}…`));
    let answer;
    try {
      answer = await api.searchMedia(source, q);
    } catch (err) {
      answer = { results: [], error: (err as Error).message, openUrl: '' };
    }
    if (mine !== seq) return;
    const openLink = answer.openUrl
      ? h('a.picker-open', { href: answer.openUrl, target: '_blank', rel: 'noopener' }, `Open this search on ${source === 'youtube' ? 'YouTube' : 'Spotify'} ↗`)
      : null;
    if (answer.error) {
      const needsSetup = source === 'spotify' && !(await api.getSettings().catch(() => null))?.spotifySearch;
      if (mine !== seq) return;
      results.replaceChildren(
        needsSetup ? spotifySetup(() => void run()) : h('p.hint.warn', {}, answer.error),
        h('p.hint', {}, openLink, openLink ? ' and paste the link of the one you want in the Recording field.' : null),
      );
      return;
    }
    results.replaceChildren(...answer.results.map((r, i) => resultRow(r, i === 0)), h('p.hint', {}, 'Not there? ', openLink));
  }

  function resultRow(r: MediaSearchResult, best: boolean): HTMLElement {
    const sub = [r.artist, r.album].filter(Boolean).join(' · ');
    return h(
      'button.picker-result',
      { type: 'button', role: 'listitem', title: r.url, onclick: () => onPick(r) },
      r.thumbnail
        ? h(`img.picker-thumb.${r.source}`, {
            src: r.thumbnail,
            alt: '',
            loading: 'lazy',
            onerror: (e: Event) => (e.target as HTMLElement).replaceWith(h(`span.picker-thumb.${r.source}`)),
          })
        : h(`span.picker-thumb.${r.source}`),
      h('span.picker-text', {}, h('span.picker-title', {}, r.title), h('small', {}, sub)),
      h('span.picker-meta', {}, best ? h('span.badge.synced', { title: 'Most likely the original recording' }, 'Best match') : null, h('small', {}, formatDuration(r.duration))),
    );
  }

  if (initialQuery.trim()) void run();
  else results.replaceChildren(h('p.hint', {}, 'Type the artist and song title.'));
  queueMicrotask(() => query.focus());
  return root;
}

/** One-time setup: Spotify's search API needs the user's own (free) developer app. */
function spotifySetup(onDone: () => void): HTMLElement {
  const id = h('input', { placeholder: 'Client ID', autocomplete: 'off', spellcheck: false });
  const secret = h('input', { type: 'password', placeholder: 'Client secret', autocomplete: 'off' });
  const status = h('small.hint');
  const save = h('button.primary', { type: 'button' }, 'Connect');
  save.addEventListener('click', async () => {
    save.disabled = true;
    status.textContent = 'Checking with Spotify…';
    status.classList.remove('warn');
    try {
      await api.setSpotifyCredentials(id.value, secret.value);
      onDone();
    } catch (err) {
      status.textContent = (err as Error).message;
      status.classList.add('warn');
    } finally {
      save.disabled = false;
    }
  });
  for (const input of [id, secret]) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      save.click();
    });
  }
  return h(
    'div.spotify-setup',
    {},
    h('p', {}, 'Searching Spotify from here needs a free Spotify developer app (one time, about two minutes):'),
    h(
      'ol',
      {},
      h('li', {}, 'Open the ', h('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'Spotify developer dashboard ↗'), ' and log in.'),
      h('li', {}, 'Create an app. Any name works; use http://127.0.0.1/callback as redirect URI and tick "Web API".'),
      h('li', {}, 'Open the app’s settings and copy its Client ID and Client secret here.'),
    ),
    h('div.spotify-setup-fields', {}, id, secret, save),
    status,
    h('small.hint', {}, 'They are stored only in your library folder (settings.json) and used only for searching.'),
  );
}
