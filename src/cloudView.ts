import type { CloudStatus, CloudTabSummary } from '../shared/cloud.ts';
import { api } from './api.ts';
import { h, toast } from './dom.ts';

const POLL_MS = 2000;
/** Fired on window with the latest `CloudStatus` whenever the dialog learns it, so the account chip follows sign-in and sign-out. */
const STATUS_EVENT = 'fretlane:cloud-status';

function announce(status: CloudStatus): void {
  window.dispatchEvent(new CustomEvent<CloudStatus>(STATUS_EVENT, { detail: status }));
}

/** "☁ Cloud" in the library: sign in to Fretlane Cloud and open tabs stored there. */
export function cloudButton(): HTMLButtonElement {
  return h('button.cloud-button', { title: 'Open tabs from your Fretlane Cloud library', onclick: () => openCloudDialog() }, '☁ Cloud');
}

/**
 * The account chip at the right end of the library's top bar: who is signed in to Fretlane Cloud,
 * or a "Sign in" button. Either way a click opens the cloud dialog, which has sign-in and sign-out.
 */
export function accountChip(): HTMLButtonElement {
  const chip = h('button.account-chip.hidden', { type: 'button', onclick: () => openCloudDialog() });
  const draw = (status: CloudStatus) => {
    chip.classList.remove('hidden');
    chip.classList.toggle('signed-in', status.connected);
    if (!status.connected) {
      chip.title = 'Sign in to Fretlane Cloud';
      chip.replaceChildren('Sign in');
      return;
    }
    const name = status.email || 'Fretlane Cloud';
    chip.title = `Signed in to Fretlane Cloud${status.email ? ` as ${status.email}` : ''}`;
    chip.replaceChildren(h('span.avatar', { 'aria-hidden': 'true' }, name[0].toUpperCase()), h('span.account-name', {}, name));
  };
  const refresh = () => api.cloudStatus().then(draw, () => undefined);
  const onStatus = (e: Event) => {
    // The library re-renders its top bar; a chip that left the page stops listening.
    if (!chip.isConnected) return stop();
    draw((e as CustomEvent<CloudStatus>).detail);
  };
  // Back from signing in in the browser (even with the dialog closed): check again.
  const onFocus = () => (chip.isConnected ? void refresh() : stop());
  const stop = () => {
    window.removeEventListener(STATUS_EVENT, onStatus);
    window.removeEventListener('focus', onFocus);
  };
  window.addEventListener(STATUS_EVENT, onStatus);
  window.addEventListener('focus', onFocus);
  void refresh();
  return chip;
}

export function openCloudDialog(): void {
  const body = h('div.cloud-body');
  const dialog = h(
    'dialog.song-dialog.cloud-dialog',
    {},
    h(
      'div.cloud-inner',
      {},
      h('h2', {}, '☁ Fretlane Cloud'),
      body,
      h('div.dialog-actions', {}, h('button', { type: 'button', onclick: () => dialog.close() }, 'Close')),
    ),
  );
  let poll: number | undefined;
  let closed = false;
  dialog.addEventListener('close', () => {
    closed = true;
    window.clearInterval(poll);
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();

  const message = (text: string, cls = 'hint') => body.replaceChildren(h(`p.${cls}`, {}, text));

  async function show(): Promise<void> {
    window.clearInterval(poll);
    message('Checking…');
    let status: CloudStatus;
    try {
      status = await api.cloudStatus();
    } catch (err) {
      return message((err as Error).message, 'form-status.error');
    }
    announce(status);
    if (closed) return;
    if (status.connected) await showTabs(status);
    else await showSignIn(status);
  }

  async function showSignIn(status: CloudStatus): Promise<void> {
    let url: string;
    try {
      ({ url } = await api.cloudLogin(location.origin));
    } catch (err) {
      return message((err as Error).message, 'form-status.error');
    }
    if (closed) return;
    // A real link (not window.open after an await) so pop-up blockers allow it; the desktop app
    // opens it in the user's normal browser.
    const signIn = h('a.button.primary', { href: url, target: '_blank', rel: 'noopener' }, 'Sign in to Fretlane Cloud');
    const waiting = h('p.hint');
    signIn.addEventListener('click', () => {
      waiting.textContent = 'Finish signing in in your browser. This window updates by itself.';
      window.clearInterval(poll);
      poll = window.setInterval(async () => {
        try {
          if ((await api.cloudStatus()).connected) await show();
        } catch {
          /* keep waiting */
        }
      }, POLL_MS);
    });
    body.replaceChildren(
      h('p', {}, 'Tabs you upload to Fretlane Cloud can be opened here and played along with their YouTube video or Spotify track.'),
      h('p.hint', {}, 'Signing in opens the Fretlane website in your browser. Sign in there with Google and approve this computer.'),
      h('div.cloud-actions', {}, signIn, h('a.button', { href: status.siteUrl, target: '_blank', rel: 'noopener' }, 'About Fretlane Cloud')),
      waiting,
    );
  }

  async function showTabs(status: CloudStatus): Promise<void> {
    const header = h(
      'div.cloud-account',
      {},
      h('span.hint', {}, `Signed in${status.email ? ` as ${status.email}` : ''}`),
      h(
        'button.mini',
        {
          type: 'button',
          onclick: async () => {
            await api.cloudLogout().catch(() => undefined);
            toast('Signed out of Fretlane Cloud');
            await show();
          },
        },
        'Sign out',
      ),
    );
    const list = h('div.cloud-list', {}, h('p.hint', {}, 'Loading your cloud tabs…'));
    body.replaceChildren(header, list);
    let tabs: CloudTabSummary[];
    try {
      tabs = await api.cloudTabs();
    } catch (err) {
      // An expired sign-in clears itself on the server: show the sign-in again.
      if (!(await api.cloudStatus().catch(() => status)).connected) return show();
      list.replaceChildren(h('p.form-status.error', {}, (err as Error).message));
      return;
    }
    if (closed) return;
    if (!tabs.length) {
      list.replaceChildren(
        h('p.hint', {}, 'No tabs in your cloud library yet. Upload them on the website: '),
        h('a', { href: new URL('/library', status.siteUrl).toString(), target: '_blank', rel: 'noopener' }, 'My tabs on the Fretlane website'),
      );
      return;
    }
    list.replaceChildren(...tabs.map(row));
  }

  function row(t: CloudTabSummary): HTMLElement {
    const open = h('button.primary', { type: 'button' }, t.songId ? 'Open' : 'Add & open');
    open.addEventListener('click', async () => {
      open.disabled = true;
      open.textContent = 'Downloading…';
      try {
        const song = await api.importCloudTab(t.id);
        if (!t.songId) toast(`Added "${song.title}" to your library`);
        dialog.close();
        location.hash = `#/song/${encodeURIComponent(song.id)}`;
      } catch (err) {
        open.disabled = false;
        open.textContent = t.songId ? 'Open' : 'Add & open';
        toast((err as Error).message, 'error');
      }
    });
    const media = t.media === 'youtube' ? h('span.badge.yt', {}, '▶ YouTube') : t.media === 'spotify' ? h('span.badge.sp', {}, '♫ Spotify') : null;
    return h(
      'div.cloud-tab',
      { 'data-cloud-id': t.id },
      h('div.cloud-tab-text', {}, h('strong', {}, t.title), h('small', {}, [t.artist || 'Unknown artist', t.format.toUpperCase()].join(' · '))),
      media,
      t.songId ? h('span.badge', { title: 'Already in your library' }, 'In library') : null,
      open,
    );
  }

  void show();
}
