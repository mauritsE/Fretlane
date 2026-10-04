/**
 * Screenshots of the real app for the Spotify social images. Run against a production build with a
 * freshly seeded library (see marketing/social/README.md):
 *   npx tsx marketing/social/capture.ts http://localhost:5183
 *
 * Spotify itself can't be loaded where these were made, so a few traditional songs are linked to a
 * placeholder Spotify track id. Nothing in the shots shows the id; the badge and the sync panel are
 * what the app shows for any Spotify link. The Spotify player is not in any shot.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5183';
const OUT = new URL('../work/social/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PLACEHOLDER_TRACK = 'https://open.spotify.com/track/0000000000000000000000';
const SPOTIFY_SONGS = ['House of the Rising Sun', 'Greensleeves', 'Scarborough Fair', 'Drunken Sailor'];

type Song = { id: string; title: string };
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

const songs = await api<Song[]>('/api/songs');
const byTitle = (t: string) => songs.find((s) => s.title === t)!;
for (const t of SPOTIFY_SONGS) {
  await api(`/api/songs/${byTitle(t).id}`, { method: 'PATCH', body: JSON.stringify({ media: PLACEHOLDER_TRACK, favorite: true }) });
}
const rising = byTitle('House of the Rising Sun');

const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
// The Spotify player can't load here; keep its script from hanging the page.
await page.route('https://open.spotify.com/**', (r) => r.fulfill({ status: 404, body: '' }));

await page.goto(BASE);
await page.waitForSelector('.song-card .badge.sp');
await page.waitForTimeout(500);
// The Greensleeves and House of the Rising Sun cards.
await page.screenshot({ path: `${OUT}lib-2.png`, clip: { x: 308.5, y: 190.5, width: 546, height: 252 } });

// Example pins, added after the library shot so its card shows just the Spotify badge.
await api(`/api/songs/${rising.id}`, { method: 'PATCH', body: JSON.stringify({ syncPoints: [{ bar: 0, time: 3.42 }, { bar: 16, time: 41.87 }] }) });

await page.goto(`${BASE}/#/song/${rising.id}`);
await page.waitForSelector('.at-overlay.hidden', { state: 'attached', timeout: 20000 });
// The "could not load the Spotify player" toast (expected here) fades after 6 s.
await page.waitForTimeout(7000);
await page.click('text=⇆ Sync');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}sync-crop.png`, clip: { x: 1086, y: 63, width: 340, height: 396 } });
await page.screenshot({ path: `${OUT}player-right.png`, clip: { x: 850, y: 63, width: 580, height: 400 } });

for (const t of SPOTIFY_SONGS) {
  await api(`/api/songs/${byTitle(t).id}`, { method: 'PATCH', body: JSON.stringify({ media: '', favorite: false, syncPoints: [] }) });
}
await browser.close();
console.log('wrote', OUT);
