/**
 * Records the real app for the Mac App Store preview (15-30 s, 1920x1080, app footage only).
 *   npx tsx appstore/preview/record.ts http://localhost:5183
 * Writes marketing/work/preview/frames/*.jpg, frames.json and marks.json; build.py cuts it.
 * The pointer, the speaker tap and the helpers are the YouTube recorder's (marketing/youtube/record.ts).
 * Only bundled public-domain songs and an original riff appear: no YouTube or Spotify footage, which
 * Apple's preview rules would count as third-party content. Needs a fresh library.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5183';
const DIR = new URL('../../marketing/work/preview/', import.meta.url).pathname;
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
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

let mouse = { x: 640, y: 360 };
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
await glide(560, 430);
await wait(1200);
await glide(740, 350);
await wait(600);

// 2. Drunken Sailor with the whole band, then another instrument.
mark('open');
await openSong('Drunken Sailor');
mark('play');
await startPlaying();
await wait(6000);
mark('tracks');
await click('.track-list li:nth-child(3)', { pause: 200 });
await rendered();
await wait(3800);
await pause();

// 3. Half speed and a two-bar loop.
mark('loop');
await click('footer button[title="Back to start"]', { pause: 300 });
await glide(640, 380);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400), await wait(60);
await wait(400);
const bars = (await page.evaluate(() => {
  const at = (window as any).fretlane.at;
  const host = document.querySelector('.at-host')!.getBoundingClientRect();
  return at.renderer.boundsLookup.staffSystems[0].bars.map((b: any) => {
    const v = b.visualBounds;
    return { x: host.left + v.x, y: host.top + v.y, w: v.w, h: v.h };
  });
})) as { x: number; y: number; w: number; h: number }[];
const a = bars[1];
const b = bars[2];
const y = a.y + a.h * 0.55;
await glide(a.x + 12, y);
await wait(200);
await page.mouse.down();
await glide(b.x + b.w - 12, y);
await page.mouse.up();
await wait(500);
if (!(await page.evaluate(() => (window as any).fretlane.at.playbackRange))) throw new Error('no range selected');
await page.keyboard.press('l'); // the loop shortcut
await wait(400);
await choose('footer select[title="Playback speed"]', '0.5', 300);
mark('loop-play');
await startPlaying();
const seen: number[] = [];
for (let i = 0; i < 20; i++) {
  seen.push(Number((await page.locator('.bar-pos').textContent())?.match(/\d+/)?.[0]));
  await wait(500);
}
if (!seen.some((v, i) => i > 2 && v < seen[i - 1])) throw new Error(`loop did not repeat: ${seen.join(',')}`);
console.log('loop bars', seen.join(','));
await pause();

// 4. Paste a plain-text tab (an original riff) and hear it.
const RIFF = `e|-----------------|-----------------|-----------------|-----------------|
B|-----------------|-----------------|-----------------|-----------------|
G|-----------------|-----------------|-----------------|---------2-------|
D|-------2---------|-------2---------|-------2---------|-----2-------2---|
A|---2-------2-0---|---2-------2-5---|---2-------2-0---|---2-----------0-|
E|-0---0-3-------3-|-0---0-3---------|-0---0-3-------3-|-0---------------|`;
await click('.topbar a.back', { pause: 200 });
await page.waitForSelector('.song-card');
await wait(300);
mark('import');
await click('.topbar button.primary', { pause: 700 });
await click('.segmented button:nth-child(3)', { pause: 400 });
mark('paste');
await click('dialog textarea', { pause: 200 });
await page.locator('dialog textarea').fill(RIFF);
await wait(900);
await click('dialog input[name="title"]', { pause: 150 });
await page.locator('dialog input[name="title"]').pressSequentially('My riff', { delay: 70 });
await wait(300);
await click('dialog button[type="submit"]', { pause: 0 });
await page.waitForSelector('.song-card[data-title="My riff"]');
await wait(700);
mark('riff');
await openSong('My riff');
await startPlaying();
mark('riff-playing');
await wait(7000);
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
