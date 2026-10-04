/**
 * Records the real app for the YouTube walkthrough: one Playwright-driven session on a 1536x864
 * viewport at 1.25x (1920x1080 frames, UI 25% larger than the LinkedIn video so it reads on a phone).
 *   npx tsx marketing/youtube/record.ts http://localhost:5183
 * Writes marketing/work/yt/frames/*.jpg, frames.json and marks.json (marks + audio-*.webm taps).
 *
 * Sound is captured from the page the same way as the Instagram take (marketing/instagram/record.ts):
 * every AudioNode connected to the speakers is also connected to a MediaRecorder, so what you hear
 * is what the app played. Needs a fresh library: it stars, archives and adds a song.
 */
import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5183';
const DIR = new URL('../work/yt/', import.meta.url).pathname;
rmSync(DIR, { recursive: true, force: true });
mkdirSync(`${DIR}frames`, { recursive: true });

// Headless Chrome draws no mouse pointer, so the page gets a visible one (added only here).
const POINTER = `
window.addEventListener('DOMContentLoaded', () => {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;';
  p.innerHTML = '<svg width="24" height="24" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.5 20 L13 19 L10.2 12.8 L16 12.5 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(p);
  addEventListener('mousemove', (e) => { p.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:36px;height:36px;border-radius:50%;border:3px solid #f5b041;left:' + (e.clientX - 18) + 'px;top:' + (e.clientY - 18) + 'px;transition:transform .45s ease-out,opacity .45s ease-out;';
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 500);
  }, true);
});`;

// Taps the speakers: one MediaRecorder per AudioContext (copied from the Instagram recorder).
const AUDIO_TAP = `
(() => {
  const taps = new Map();
  window.__audioTaps = [];
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) {
      let tap = taps.get(dest.context);
      if (!tap) {
        const node = dest.context.createMediaStreamDestination();
        // A silent constant source keeps samples flowing, so pauses stay pauses in the recording.
        const keepAlive = dest.context.createConstantSource();
        keepAlive.offset.value = 0;
        connect.call(keepAlive, node);
        keepAlive.start();
        const rec = new MediaRecorder(node.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
        tap = { node, rec, chunks: [], start: 0 };
        rec.ondataavailable = (e) => tap.chunks.push(e.data);
        rec.onstart = () => { tap.start = Date.now() / 1000; };
        rec.start();
        taps.set(dest.context, tap);
        window.__audioTaps.push(tap);
      }
      connect.call(this, tap.node);
    }
    return r;
  };
  window.__stopAudioTaps = async () => Promise.all(window.__audioTaps.map((t) => new Promise((resolve) => {
    t.rec.onstop = async () => {
      const buf = new Uint8Array(await new Blob(t.chunks).arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      resolve({ start: t.start, data: btoa(bin) });
    };
    t.rec.stop();
  })));
})();`;

const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25 });
await page.addInitScript(POINTER);
await page.addInitScript(AUDIO_TAP);
await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404, body: '' }));

const frames: { file: string; t: number }[] = [];
const marks: Record<string, number> = {};
const cdp = await page.context().newCDPSession(page);
let n = 0;
cdp.on('Page.screencastFrame', (f) => {
  const file = `frames/${String(n++).padStart(6, '0')}.jpg`;
  writeFileSync(`${DIR}${file}`, Buffer.from(f.data, 'base64'));
  frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
  void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
});
const mark = (name: string) => {
  marks[name] = Date.now() / 1000;
  console.log('mark', name);
};
const wait = (ms: number) => page.waitForTimeout(ms);

let mouse = { x: 768, y: 432 };
async function glide(x: number, y: number): Promise<void> {
  await page.mouse.move(x, y, { steps: Math.max(10, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 16)) });
  mouse = { x, y };
}
/** Glides the pointer to an element and clicks it, like a person would. */
async function click(selector: string, opts: { pause?: number } = {}): Promise<void> {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error(`not visible: ${selector}`);
  await glide(box.x + box.width / 2, box.y + box.height / 2);
  await wait(200);
  await page.mouse.click(mouse.x, mouse.y);
  await wait(opts.pause ?? 700);
}
async function choose(selector: string, value: string, pause = 600): Promise<void> {
  await click(selector, { pause: 250 });
  await page.selectOption(selector, value);
  await page.keyboard.press('Escape');
  await wait(pause);
}
async function rendered(): Promise<void> {
  await page.waitForSelector('.at-host svg', { timeout: 20000 });
  await page.waitForSelector('.at-overlay.hidden', { state: 'attached', timeout: 20000 });
}
async function startPlaying(): Promise<void> {
  const state = () => page.evaluate(() => { const at = (window as any).fretlane.at; return `state=${at.playerState} ready=${at.isReadyForPlayback} tick=${at.tickPosition}`; });
  console.log('  before play', await state());
  await click('button.play', { pause: 0 });
  try {
    await page.waitForFunction(() => (window as any).fretlane.at.playerState === 1, undefined, { polling: 'raf', timeout: 5000 });
  } catch (e) {
    console.log('  not playing', await state());
    throw e;
  }
}
/** Pauses if playing. The song may already have ended by itself, and then a click would restart it. */
async function pause(): Promise<void> {
  if (await page.evaluate(() => (window as any).fretlane.at.playerState === 1)) await click('button.play', { pause: 400 });
  if (await page.evaluate(() => (window as any).fretlane.at.playerState === 1)) throw new Error('still playing after pause');
}
async function openSong(title: string): Promise<void> {
  await click(`.song-card[data-title="${title}"] .card-link`, { pause: 200 });
  await rendered();
  await wait(700);
}

await page.goto(BASE);
await page.waitForSelector('.song-card');
await page.mouse.move(mouse.x, mouse.y);
await wait(800);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await wait(500);

// 1. The library.
mark('library');
await wait(1500);
await glide(768, 600);
for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 180), await wait(260);
await wait(900);
for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -180), await wait(160);
await wait(500);
mark('filter');
await click('.tag-bar button:text-is("beginner")', { pause: 1800 });
await click('.tag-bar button:text-is("All")', { pause: 700 });
mark('search');
await click('input.search', { pause: 200 });
await page.locator('input.search').pressSequentially('sailor', { delay: 110 });
await wait(1600);

// 2. Play a song with the whole band.
mark('open');
await openSong('Drunken Sailor');
mark('play');
await startPlaying();
mark('playing');
await wait(6500);
mark('tracks');
await click('.track-list li:nth-child(3)', { pause: 200 });
await rendered();
await wait(3300);
await click('.track-list li:nth-child(4)', { pause: 200 });
await rendered();
await wait(3300);
await click('.track-list li:nth-child(1)', { pause: 200 });
await rendered();
await wait(1500);
mark('solo');
// Drunken Sailor lasts 25.6 s: pause well before it ends, or the pause click could restart it.
await click('.track-list li:nth-child(3) button.mini[title="Solo"]', { pause: 3200 });
await click('.track-list li:nth-child(3) button.mini[title="Solo"]', { pause: 1200 });
mark('notation');
await pause();
await choose('footer select[title="Zoom"]', '1.2', 300);
await rendered();
await wait(2000);
await choose('footer select[title="Layout"]', 'horizontal', 300);
await rendered();
await wait(2400);
await choose('footer select[title="Layout"]', 'page', 300);
await rendered();
await choose('footer select[title="Zoom"]', '0.9', 300);
await rendered();
await wait(900);

// 3. Practice: half speed, then a loop over two bars with count-in and click track.
mark('speed');
await choose('footer select[title="Playback speed"]', '0.5', 300);
await startPlaying();
await wait(5000);
await pause();
mark('loop');
await click('footer button[title="Back to start"]', { pause: 300 });
await glide(768, 450);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400), await wait(60);
await wait(500);
const bars = (await page.evaluate(() => {
  const at = (window as any).fretlane.at;
  const host = document.querySelector('.at-host')!.getBoundingClientRect();
  return at.renderer.boundsLookup.staffSystems[0].bars.map((b: any) => {
    const v = b.visualBounds;
    return { x: host.left + v.x, y: host.top + v.y, w: v.w, h: v.h };
  });
})) as { x: number; y: number; w: number; h: number }[];
const a = bars[2];
const b = bars[3];
const y = a.y + a.h * 0.55;
await glide(a.x + 12, y);
await wait(250);
await page.mouse.down();
await glide(b.x + b.w - 12, y);
await page.mouse.up();
await wait(700);
if (!(await page.evaluate(() => (window as any).fretlane.at.playbackRange))) throw new Error('no range selected');
await page.keyboard.press('l'); // the loop shortcut
await wait(600);
await choose('footer select[title="Playback speed"]', '0.75', 300);
await click('footer button.toggle:has-text("1-2-3-4")', { pause: 400 });
await click('footer button.toggle:has-text("Click track")', { pause: 400 });
mark('loop-play');
await startPlaying();
// Proof the loop holds: the bar counter must jump back at least once.
const seen: number[] = [];
for (let i = 0; i < 26; i++) {
  seen.push(Number((await page.locator('.bar-pos').textContent())?.match(/\d+/)?.[0]));
  await wait(500);
}
if (!seen.some((v, i) => i > 2 && v < seen[i - 1])) throw new Error(`loop did not repeat: ${seen.join(',')}`);
console.log('loop bars', seen.join(','));
await pause();

// 4. The metronome.
mark('metronome');
await click('.topbar .metronome-btn', { pause: 800 });
await click('.metronome-panel .song-tempo button', { pause: 700 });
await click('.metronome-start', { pause: 3000 });
mark('subdivision');
await choose('.metronome-panel select[title="Clicks per beat"]', '3', 2600);
await choose('.metronome-panel select[title="Clicks per beat"]', '1', 400);
mark('tap');
for (let i = 0; i < 6; i++) await click('.metronome-panel button.tap', { pause: 350 });
await wait(2600);
await click('.metronome-start', { pause: 400 });
await click('.metronome-panel .sync-head button', { pause: 500 });

// 5. Favorites and the archive.
mark('favorite');
await click('.topbar .star-toggle', { pause: 1300 });
await click('.topbar a.back', { pause: 200 });
await page.waitForSelector('.song-card');
await page.locator('input.search').fill('');
await page.locator('input.search').dispatchEvent('input');
await wait(1200);
await click('.song-card[data-title="Greensleeves"] button.star', { pause: 900 });
await click('.view-bar [data-view="favorites"]', { pause: 1800 });
await click('.view-bar [data-view="all"]', { pause: 700 });
mark('archive');
await click('.song-card[data-title="Twinkle Twinkle Little Star"] button.done', { pause: 1000 });
await click('.view-bar [data-view="archive"]', { pause: 1800 });
await click('.song-card[data-title="Twinkle Twinkle Little Star"] button.restore', { pause: 1300 });
await click('.view-bar [data-view="all"]', { pause: 800 });

// 6. Bring your own tab: the three sources, then paste a plain-text riff (original) and play it.
const RIFF = `e|-----------------|-----------------|-----------------|-----------------|
B|-----------------|-----------------|-----------------|-----------------|
G|-----------------|-----------------|-----------------|---------2-------|
D|-------2---------|-------2---------|-------2---------|-----2-------2---|
A|---2-------2-0---|---2-------2-5---|---2-------2-0---|---2-----------0-|
E|-0---0-3-------3-|-0---0-3---------|-0---0-3-------3-|-0---------------|`;
mark('import');
await click('.topbar button.primary', { pause: 1400 });
await click('.segmented button:nth-child(2)', { pause: 1400 });
await click('.segmented button:nth-child(3)', { pause: 600 });
mark('paste');
await click('dialog textarea', { pause: 300 });
await page.locator('dialog textarea').fill(RIFF);
await wait(1300);
await click('dialog input[name="title"]', { pause: 200 });
await page.locator('dialog input[name="title"]').pressSequentially('My riff', { delay: 70 });
await wait(500);
await click('dialog button[type="submit"]', { pause: 0 });
await page.waitForSelector('.song-card[data-title="My riff"]');
await wait(1000);
mark('riff');
await openSong('My riff');
await startPlaying();
mark('riff-playing');
await wait(8500);
await pause();
mark('end');
await wait(600);

await cdp.send('Page.stopScreencast');
const audio = (await page.evaluate('window.__stopAudioTaps()')) as { start: number; data: string }[];
const tracks = audio.map((t, i) => {
  writeFileSync(`${DIR}audio-${i}.webm`, Buffer.from(t.data, 'base64'));
  return { file: `audio-${i}.webm`, start: t.start };
});
writeFileSync(`${DIR}frames.json`, JSON.stringify(frames));
writeFileSync(`${DIR}marks.json`, JSON.stringify({ marks, audio: tracks }, null, 2));
await browser.close();
console.log(`${frames.length} frames, ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)} s, ${tracks.length} audio track(s)`);
