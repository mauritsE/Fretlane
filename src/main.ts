import './styles.css';
import { renderLibrary } from './libraryView.ts';
import { renderPlayer } from './playerView.ts';

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;
let navId = 0;

async function route(): Promise<void> {
  const id = ++navId;
  cleanup?.();
  cleanup = null;
  const match = location.hash.match(/^#\/song\/([^?]+)/);
  document.body.dataset.view = match ? 'player' : 'library';
  if (match) {
    const c = await renderPlayer(app, decodeURIComponent(match[1]));
    // If the user navigated again while the player was loading, tear the stale one down.
    if (id !== navId) c();
    else cleanup = c;
  } else {
    await renderLibrary(app);
  }
}

window.addEventListener('hashchange', () => void route());
void route();
