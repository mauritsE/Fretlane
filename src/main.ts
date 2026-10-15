import './styles.css';
import { renderLibrary } from './libraryView.ts';
import { renderPlayer } from './playerView.ts';
import { renderEditor } from './editorView.ts';

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;
let navId = 0;

async function route(): Promise<void> {
  const id = ++navId;
  cleanup?.();
  cleanup = null;
  const match = location.hash.match(/^#\/(song|write)\/([^?]+)/);
  // The editor uses the player's full-height layout.
  document.body.dataset.view = match ? 'player' : 'library';
  document.body.dataset.mode = match?.[1] === 'write' ? 'write' : '';
  if (match) {
    const songId = decodeURIComponent(match[2]);
    const c = match[1] === 'write' ? await renderEditor(app, songId) : await renderPlayer(app, songId);
    // If the user navigated again while the player was loading, tear the stale one down.
    if (id !== navId) c();
    else cleanup = c;
  } else {
    await renderLibrary(app);
  }
}

window.addEventListener('hashchange', () => void route());
void route();
