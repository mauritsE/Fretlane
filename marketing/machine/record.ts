/**
 * Records one Short's footage from the real app: a Playwright-driven Chromium on a portrait
 * viewport (864x1080 at 1.25x = 1080x1350 frames), screencast frames plus the app's own sound.
 *
 * The sound is tapped from the page: every AudioNode connected to the speakers is also connected
 * to a MediaRecorder, so the soundtrack is exactly what the app played. Same technique as
 * ../instagram/record.ts. Each take checks itself: it fails unless the bar counter moved while
 * playing, and the half-speed take fails unless the player really ran at 0.5.
 *
 * Writes <dir>/frames/*.jpg, frames.json, marks.json and audio-*.webm.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { ShortFormat } from './plan.ts';

// Headless Chrome draws no mouse pointer. The track tour clicks tracks, so it gets a visible one
// (hidden off-screen until the mouse first moves).
const POINTER = `
window.addEventListener('DOMContentLoaded', () => {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;left:-40px;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;';
  p.innerHTML = '<svg width="26" height="26" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.5 20 L13 19 L10.2 12.8 L16 12.5 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(p);
  addEventListener('mousemove', (e) => { p.style.left = '0'; p.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:40px;height:40px;border-radius:50%;border:4px solid #f5b041;left:' + (e.clientX - 20) + 'px;top:' + (e.clientY - 20) + 'px;transition:transform .45s ease-out,opacity .45s ease-out;';
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 500);
  }, true);
});`;

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
        // A silent source keeps samples flowing, so pauses stay pauses in the recording.
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

/** Seconds of each segment. Shorts and Reels hold attention for about this long. */
export const SEGMENT_SECONDS: Record<ShortFormat, number[]> = {
  'play-along': [22],
  'half-speed': [11, 11],
  'track-tour': [7.5, 7.5, 7.5],
};
/** Recorded after the last segment: the music under the end card. */
export const TAIL_SECONDS = 3;

export interface TakeMeta {
  /** Segment boundaries, wall-clock seconds: [start, end] per segment. */
  segments: [number, number][];
  /** End of the tail (music under the end card). */
  tailEnd: number;
  audio: { file: string; start: number }[];
  /** Bar numbers seen while recording, as proof the cursor moved. */
  bars: number[];
}

export async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
}

const now = () => Date.now() / 1000;
/** Where the pointer rests between clicks: the empty part of the track sidebar, off the tab. */
const IDLE = { x: 105, y: 900 };

async function rendered(p: Page): Promise<void> {
  await p.waitForSelector('.at-host svg', { timeout: 30000 });
  await p.waitForSelector('.at-overlay.hidden', { state: 'attached', timeout: 30000 });
}

async function barNumber(p: Page): Promise<number> {
  return Number((await p.locator('.bar-pos').textContent())?.match(/\d+/)?.[0] ?? NaN);
}

/** Waits `seconds` while noting the bar counter every half second. */
async function watch(p: Page, seconds: number, bars: number[]): Promise<void> {
  const end = now() + seconds;
  while (now() < end) {
    bars.push(await barNumber(p));
    await p.waitForTimeout(Math.min(500, Math.max(0, (end - now()) * 1000)));
  }
}

async function play(p: Page): Promise<void> {
  await p.locator('button.play').click();
  await p.waitForFunction(() => (window as any).fretlane.at.playerState === 1, undefined, { polling: 'raf', timeout: 30000 });
}
async function pause(p: Page): Promise<void> {
  await p.locator('button.play').click();
  await p.waitForFunction(() => (window as any).fretlane.at.playerState === 0, undefined, { polling: 'raf' });
}

/** Records one take of `title` in `format` into `dir`. Needs a server on `base` with a fresh library. */
export async function recordShort(browser: Browser, base: string, song: { title: string; tour?: string[] }, format: ShortFormat, dir: string): Promise<TakeMeta> {
  const title = song.title;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${dir}/frames`, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 864, height: 1080 }, deviceScaleFactor: 1.25 });
  if (format === 'track-tour') await page.addInitScript(POINTER);
  await page.addInitScript(AUDIO_TAP);
  await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404, body: '' }));

  // Open the song before recording starts: the Short shows the player only.
  await page.goto(base);
  await page.locator(`.song-card[data-title="${title.replace(/"/g, '\\"')}"] .card-link`).click();
  await rendered(page);
  // Largest zoom: the notes have to be readable on a phone.
  await page.selectOption('footer select[title="Zoom"]', '1.4');
  await rendered(page);
  // The app remembers the last track per song; every take starts on the first one (the melody).
  if (await page.evaluate(() => (window as any).fretlane.song.defaultTrack !== 0)) {
    await page.locator('.track-list li:nth-child(1)').click();
    await rendered(page);
  }
  await page.mouse.move(-10, -10);
  await page.waitForTimeout(800);

  const frames: { file: string; t: number }[] = [];
  const cdp = await page.context().newCDPSession(page);
  let n = 0;
  cdp.on('Page.screencastFrame', (f) => {
    const file = `frames/${String(n++).padStart(6, '0')}.jpg`;
    writeFileSync(`${dir}/${file}`, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp ?? now() });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1350, everyNthFrame: 1 });
  await page.waitForTimeout(400);

  const lens = SEGMENT_SECONDS[format];
  const segments: [number, number][] = [];
  const bars: number[] = [];

  if (format === 'play-along') {
    const t0 = now();
    await play(page);
    await watch(page, lens[0], bars);
    segments.push([t0, now()]);
  } else if (format === 'half-speed') {
    await page.selectOption('footer select[title="Playback speed"]', '0.5');
    const t0 = now();
    await play(page);
    if ((await page.evaluate(() => (window as any).fretlane.at.playbackSpeed)) !== 0.5) throw new Error('player is not at half speed');
    await watch(page, lens[0], bars);
    await pause(page);
    segments.push([t0, now()]);
    await page.locator('footer button[title="Back to start"]').click();
    await page.selectOption('footer select[title="Playback speed"]', '1');
    await page.waitForTimeout(300);
    const t1 = now();
    await play(page);
    await watch(page, lens[1], bars);
    segments.push([t1, now()]);
  } else {
    // The tracks to show, by name (plan.ts tourTracks), e.g. Melody, Bass, Drums.
    const names = await page.evaluate(() => (window as any).fretlane.at.score.tracks.map((t: any) => String(t.name)) as string[]);
    const order = (song.tour ?? []).map((n) => names.indexOf(n));
    if (order.length !== 3 || order.some((i) => i < 0)) throw new Error(`track tour ${song.tour} does not match the tab's tracks ${names}`);
    await page.mouse.move(IDLE.x, IDLE.y);
    let t = now();
    await play(page);
    await page.mouse.move(IDLE.x, IDLE.y, { steps: 8 });
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        const el = page.locator(`.track-list li:nth-child(${order[i] + 1})`);
        const box = (await el.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
        segments.push([t, now()]);
        t = now();
        await page.mouse.down();
        await page.mouse.up();
        await rendered(page);
        await page.mouse.move(IDLE.x, IDLE.y, { steps: 12 });
        await watch(page, lens[i] - 1, bars);
      } else {
        await watch(page, lens[i], bars);
      }
    }
    segments.push([t, now()]);
  }
  await watch(page, TAIL_SECONDS, bars);
  const tailEnd = now();
  await cdp.send('Page.stopScreencast');

  const audio = (await page.evaluate('window.__stopAudioTaps()')) as { start: number; data: string }[];
  const files = audio.map((a, i) => {
    writeFileSync(`${dir}/audio-${i}.webm`, Buffer.from(a.data, 'base64'));
    return { file: `audio-${i}.webm`, start: a.start };
  });
  await page.close();

  const moved = bars.filter((b, i) => i > 0 && b > bars[i - 1]).length;
  if (!files.length) throw new Error('the app played no sound');
  if (moved < 2) throw new Error(`the cursor did not move: bars ${bars.join(',')}`);
  if (!frames.length) throw new Error('no frames recorded');

  const meta: TakeMeta = { segments, tailEnd, audio: files, bars };
  writeFileSync(`${dir}/frames.json`, JSON.stringify(frames));
  writeFileSync(`${dir}/marks.json`, JSON.stringify(meta, null, 2));
  return meta;
}
