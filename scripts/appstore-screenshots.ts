/**
 * Takes the Mac App Store screenshots (2880x1800, Apple's largest Mac size) from the real app:
 *   npm start  (or the dev server)   then   npx tsx scripts/appstore-screenshots.ts [baseUrl]
 * Uses a running Fretlane with the bundled library. Writes appstore/screenshots/*.png.
 */
import { chromium, type Page } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = new URL('../appstore/screenshots/', import.meta.url).pathname;

const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404, body: '' }));

interface Song {
  id: string;
  title: string;
  favorite: boolean;
  archivedAt: string | null;
}
const songs = (await (await fetch(`${BASE}/api/songs`)).json()) as Song[];
const byTitle = (t: string) => songs.find((s) => s.title === t)!;
const patch = (s: Song, body: object) =>
  fetch(`${BASE}/api/songs/${s.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function rendered(p: Page): Promise<void> {
  await p.waitForSelector('.at-host svg', { timeout: 20000 });
  await p.waitForSelector('.at-overlay.hidden', { state: 'attached', timeout: 20000 });
}

// A lived-in library: a few favorites and a couple of finished songs.
const favorites = ['Greensleeves', 'In the Hall of the Mountain King', 'House of the Rising Sun'].map(byTitle);
const done = ['Twinkle Twinkle Little Star', 'Frère Jacques'].map(byTitle);
for (const s of favorites) await patch(s, { favorite: true });
for (const s of done) await patch(s, { archived: true });

try {
  await page.goto(BASE);
  await page.waitForSelector('.song-card');
  await page.screenshot({ path: `${OUT}1-library.png` });

  await page.goto(`${BASE}/#/song/${byTitle('In the Hall of the Mountain King').id}`);
  await rendered(page);
  await page.click('button.play');
  await page.waitForTimeout(3500);
  await page.click('button.play');
  await page.screenshot({ path: `${OUT}2-player.png` });

  await page.goto(`${BASE}/#/song/${byTitle('Greensleeves').id}`);
  await rendered(page);
  await page.keyboard.press('m');
  await page.click('.metronome-panel .song-tempo button');
  await page.click('.metronome-start');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}3-metronome.png` });
  await page.click('.metronome-start');
  await page.keyboard.press('m');

  await page.goto(BASE);
  await page.waitForSelector('.song-card');
  await page.click('.view-bar [data-view="archive"]');
  await page.screenshot({ path: `${OUT}4-archive.png` });
} finally {
  for (const s of favorites) await patch(s, { favorite: s.favorite });
  for (const s of done) await patch(s, { archived: !!s.archivedAt });
  await browser.close();
}
console.log(`Screenshots written to ${OUT}`);
