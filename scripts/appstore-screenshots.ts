/**
 * Takes the Mac App Store screenshots (2880x1800, Apple's largest Mac size) from the real app:
 *   npm run build   then   npx tsx scripts/appstore-screenshots.ts
 * Starts its own Fretlane on a fresh library (appstore/demo-env.ts), so your own library is never
 * touched. Writes appstore/screenshots/*.png.
 */
import { chromium, type Page } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { renderSongWav, startDemo } from '../appstore/demo-env.ts';

const OUT = new URL('../appstore/screenshots/', import.meta.url).pathname;
const demo = await startDemo();
const BASE = demo.base;

const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404, body: '' }));

interface Song {
  id: string;
  title: string;
}
const songs = (await (await fetch(`${BASE}/api/songs`)).json()) as Song[];
const byTitle = (t: string) => songs.find((s) => s.title === t)!;
const patch = (s: Song, body: object) =>
  fetch(`${BASE}/api/songs/${s.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function rendered(p: Page): Promise<void> {
  await p.waitForSelector('.at-host svg', { timeout: 20000 });
  await p.waitForSelector('.at-overlay.hidden', { state: 'attached', timeout: 20000 });
}

try {
  // A lived-in library: a few favorites, a couple of finished songs, and one song with its own recording.
  for (const t of ['Greensleeves', 'In the Hall of the Mountain King', 'House of the Rising Sun']) await patch(byTitle(t), { favorite: true });
  for (const t of ['Twinkle Twinkle Little Star', 'Frère Jacques']) await patch(byTitle(t), { archived: true });
  // The recording is the song rendered by Fretlane's own synthesizer, after a second of silence.
  const rising = byTitle('House of the Rising Sun');
  const wav = await renderSongWav(page, BASE, rising.id);
  const put = await fetch(`${BASE}/api/songs/${rising.id}/audio`, { method: 'PUT', headers: { 'x-file-name': encodeURIComponent('House of the Rising Sun.wav') }, body: new Uint8Array(wav) });
  if (!put.ok) throw new Error(`audio upload failed: ${put.status} ${await put.text()}`);
  await patch(rising, { syncPoints: [{ bar: 0, time: 1 }] });

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

  // Standard notation above the tab.
  await page.goto(`${BASE}/#/song/${byTitle('Für Elise').id}`);
  await rendered(page);
  await page.selectOption('select[title="Notation"]', { label: 'Score + Tab' });
  // The old tab-only SVG is still on the page while alphaTab re-lays out, so wait for a standard staff.
  await page.waitForFunction(() => document.querySelectorAll('.at-host svg').length > 0 && !!document.querySelector('.at-host')?.textContent?.includes('Melody') , undefined, { timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}5-notation.png` });

  // Importing your own tab: paste a plain-text tab (the original demo riff that ships with the app).
  await page.goto(BASE);
  await page.waitForSelector('.song-card');
  await page.click('button.primary:has-text("Add song")');
  await page.click('.song-dialog .segmented button:has-text("Paste text")');
  const tab = readFileSync(new URL('../demo/night-trail.txt', import.meta.url), 'utf8');
  await page.fill('.song-dialog textarea', tab);
  await page.fill('.song-dialog input[name="title"]', 'Night Trail');
  await page.fill('.song-dialog input[name="tags"]', 'riff, practice');
  await page.screenshot({ path: `${OUT}6-add-song.png` });
  await page.keyboard.press('Escape');

  // Playing along with your own audio file, with the waveform in the sync panel.
  await page.goto(`${BASE}/#/song/${rising.id}`);
  await rendered(page);
  await page.waitForFunction(() => ((document.querySelector('.video-box audio') as HTMLAudioElement | null)?.duration ?? 0) > 5);
  await page.click('text=⇆ Sync');
  await page.waitForSelector('.sync-panel .waveform[data-state=ready]', { timeout: 20000 });
  await page.click('button.play');
  await page.waitForTimeout(6000);
  await page.click('button.play');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}7-audio-file.png` });

  // Fretlane Cloud: the demo account's tabs, one already in the library.
  await demo.signIn();
  await fetch(`${BASE}/api/cloud/tabs/d2/import`, { method: 'POST' });
  await page.goto(BASE);
  await page.waitForSelector('.song-card');
  await page.click('button.cloud-button');
  await page.waitForSelector('.cloud-tab');
  await page.screenshot({ path: `${OUT}8-cloud.png` });
} finally {
  await browser.close();
  await demo.close();
}
console.log(`Screenshots written to ${OUT}`);
