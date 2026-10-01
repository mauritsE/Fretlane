/**
 * Records the real app for the marketing video: drives a running Fretlane with Playwright and
 * captures Chrome's screencast frames (sharper than Playwright's built-in video) plus named
 * markers, which marketing/build.py uses to cut the story.
 *   npx tsx marketing/record.ts http://localhost:5180
 * Writes marketing/work/frames/*.jpg, frames.json and marks.json. The library must be the
 * freshly seeded one (no favorites or archived songs).
 */
import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const WORK = new URL('./work/', import.meta.url).pathname;
rmSync(`${WORK}frames`, { recursive: true, force: true });
mkdirSync(`${WORK}frames`, { recursive: true });

// Headless Chrome draws no mouse pointer, so the page gets a visible one (added only here).
const POINTER = `
window.addEventListener('DOMContentLoaded', () => {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transition:transform .04s linear;';
  p.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.5 20 L13 19 L10.2 12.8 L16 12.5 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(p);
  addEventListener('mousemove', (e) => { p.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:34px;height:34px;border-radius:50%;border:3px solid #f5b041;left:' + (e.clientX - 17) + 'px;top:' + (e.clientY - 17) + 'px;transition:transform .45s ease-out,opacity .45s ease-out;';
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 500);
  }, true);
});`;

const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(POINTER);
await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404, body: '' }));

const frames: { file: string; t: number }[] = [];
const marks: Record<string, number> = {};
const cdp = await page.context().newCDPSession(page);
let n = 0;
cdp.on('Page.screencastFrame', (f) => {
  const file = `frames/${String(n++).padStart(6, '0')}.jpg`;
  writeFileSync(`${WORK}${file}`, Buffer.from(f.data, 'base64'));
  frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
  void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
});
const mark = (name: string) => {
  marks[name] = Date.now() / 1000;
  console.log('mark', name);
};

let mouse = { x: 960, y: 540 };
/** Glides the pointer to an element and clicks it, like a person would. */
async function click(p: Page, selector: string, opts: { pause?: number } = {}): Promise<void> {
  await p.locator(selector).first().scrollIntoViewIfNeeded();
  const box = await p.locator(selector).first().boundingBox();
  if (!box) throw new Error(`not visible: ${selector}`);
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await p.mouse.move(to.x, to.y, { steps: Math.max(12, Math.round(Math.hypot(to.x - mouse.x, to.y - mouse.y) / 18)) });
  mouse = to;
  await p.waitForTimeout(220);
  await p.mouse.click(to.x, to.y);
  await p.waitForTimeout(opts.pause ?? 700);
}
async function rendered(p: Page): Promise<void> {
  await p.waitForSelector('.at-host svg', { timeout: 20000 });
  await p.waitForSelector('.at-overlay.hidden', { state: 'attached', timeout: 20000 });
}

await page.goto(BASE);
await page.waitForSelector('.song-card');
await page.mouse.move(mouse.x, mouse.y);
await page.waitForTimeout(800);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await page.waitForTimeout(500);

// 1. The library: 25 songs ready to play.
mark('library');
await page.waitForTimeout(1500);
await page.mouse.move(960, 700, { steps: 20 });
await page.mouse.wheel(0, 500);
await page.waitForTimeout(1600);
await page.mouse.wheel(0, -500);
await page.waitForTimeout(900);
mark('filter');
await click(page, '.tag-bar button:text-is("beginner")', { pause: 1600 });
await click(page, '.tag-bar button:text-is("All")', { pause: 600 });

// 2. Open a song and play it with the built-in band.
mark('open');
await click(page, '.song-card[data-title="In the Hall of the Mountain King"] .card-link', { pause: 200 });
await rendered(page);
await page.waitForTimeout(600);
mark('play');
await click(page, 'button.play', { pause: 0 });
await page.waitForFunction(() => (window as any).fretlane.at.playerState === 1, undefined, { polling: 'raf' });
mark('playing'); // the soundtrack (marketing/export-audio.ts) is aligned to this moment
await page.waitForTimeout(5000);
mark('tracks');
await click(page, '.track-list li:nth-child(4)', { pause: 200 });
await rendered(page);
await page.waitForTimeout(2800);
await click(page, '.track-list li:nth-child(1)', { pause: 200 });
await rendered(page);
await page.waitForTimeout(1500);
mark('speed');
await click(page, 'button.play', { pause: 300 });
await page.selectOption('footer select[title="Playback speed"]', '0.5');
await page.waitForTimeout(300);
await click(page, 'button.play', { pause: 3500 });
await click(page, 'button.play', { pause: 500 });

// 3. Metronome at the song's tempo.
mark('metronome');
await click(page, '.topbar .metronome-btn', { pause: 900 });
await click(page, '.metronome-panel .song-tempo button', { pause: 900 });
await click(page, '.metronome-start', { pause: 3000 });
mark('tap');
for (let i = 0; i < 5; i++) await click(page, '.metronome-panel button.tap', { pause: 380 });
await page.waitForTimeout(1600);
await click(page, '.metronome-start', { pause: 400 });
await click(page, '.metronome-panel .sync-head button', { pause: 500 });

// 4. Favorite it, then find it at the top of the library.
mark('favorite');
await click(page, '.topbar .star-toggle', { pause: 1400 });
await click(page, '.topbar a.back', { pause: 200 });
await page.waitForSelector('.song-card');
await page.waitForTimeout(1500);
await click(page, '.view-bar [data-view="favorites"]', { pause: 1500 });
await click(page, '.view-bar [data-view="all"]', { pause: 600 });

// 5. Finished learning a song? Archive it.
mark('archive');
await click(page, '.song-card[data-title="Jingle Bells"] button.done', { pause: 1200 });
await click(page, '.view-bar [data-view="archive"]', { pause: 2400 });
await click(page, '.view-bar [data-view="all"]', { pause: 600 });

// 6. Bring your own tabs.
mark('import');
await click(page, '.topbar button.primary', { pause: 1200 });
await click(page, '.segmented button:text-is("Paste text")', { pause: 600 });
await page.locator('dialog textarea').pressSequentially('e|---0---3---5---|\nB|---1-----------|\nG|---0-----------|\nD|---2-----------|\nA|---3-----------|\nE|---------------|', { delay: 12 });
await page.waitForTimeout(1500);
mark('end');
await page.waitForTimeout(800);

await cdp.send('Page.stopScreencast');
writeFileSync(`${WORK}frames.json`, JSON.stringify(frames));
writeFileSync(`${WORK}marks.json`, JSON.stringify(marks, null, 2));
await browser.close();
console.log(`${frames.length} frames, ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)} s`);
