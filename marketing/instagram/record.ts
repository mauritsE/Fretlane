/**
 * Records the real app for the Instagram Reels: one "take" per reel, each a Playwright-driven session
 * on a portrait viewport (864x1080 at 1.25x = 1080x1350 frames, wide enough to keep the track list).
 *   npx tsx marketing/instagram/record.ts http://localhost:5183 [take...]
 * Per take it writes marketing/work/ig/<take>/frames/*.jpg, frames.json, marks.json and audio-*.webm.
 *
 * Sound is captured from the page itself: every AudioNode connected to the speakers is also
 * connected to a MediaRecorder, so the soundtrack is exactly what the app played (synth, metronome,
 * half speed, loops), with its wall-clock start time for alignment. Needs a fresh library.
 */
import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5183';
const ONLY = process.argv.slice(3);
const WORK = new URL('../work/ig/', import.meta.url).pathname;

// Headless Chrome draws no mouse pointer, so the page gets a visible one (added only here).
const POINTER = `
window.addEventListener('DOMContentLoaded', () => {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;';
  p.innerHTML = '<svg width="26" height="26" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.5 20 L13 19 L10.2 12.8 L16 12.5 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(p);
  addEventListener('mousemove', (e) => { p.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:40px;height:40px;border-radius:50%;border:4px solid #f5b041;left:' + (e.clientX - 20) + 'px;top:' + (e.clientY - 20) + 'px;transition:transform .45s ease-out,opacity .45s ease-out;';
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 500);
  }, true);
});`;

// Taps the speakers: one MediaRecorder per AudioContext, started when something first plays into it.
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
        // A silent constant source keeps samples flowing, so pauses stay pauses in the recording
        // (otherwise Chrome's MediaRecorder collapses the time the app was silent).
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

interface Take {
  page: Page;
  mark: (name: string) => void;
  click: (selector: string, opts?: { pause?: number }) => Promise<void>;
  glide: (x: number, y: number) => Promise<void>;
}

async function take(name: string, script: (t: Take) => Promise<void>): Promise<void> {
  if (ONLY.length && !ONLY.includes(name)) return;
  const dir = `${WORK}${name}/`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${dir}frames`, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 864, height: 1080 }, deviceScaleFactor: 1.25 });
  await page.addInitScript(POINTER);
  await page.addInitScript(AUDIO_TAP);
  await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404, body: '' }));

  const frames: { file: string; t: number }[] = [];
  const marks: Record<string, number> = {};
  const cdp = await page.context().newCDPSession(page);
  let n = 0;
  cdp.on('Page.screencastFrame', (f) => {
    const file = `frames/${String(n++).padStart(6, '0')}.jpg`;
    writeFileSync(`${dir}${file}`, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
  });
  let mouse = { x: 430, y: 600 };
  const glide = async (x: number, y: number) => {
    await page.mouse.move(x, y, { steps: Math.max(10, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 14)) });
    mouse = { x, y };
  };
  const t: Take = {
    page,
    mark: (m) => {
      marks[m] = Date.now() / 1000;
      console.log(name, 'mark', m);
    },
    glide,
    click: async (selector, opts = {}) => {
      const el = page.locator(selector).first();
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      if (!box) throw new Error(`not visible: ${selector}`);
      await glide(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);
      await page.mouse.click(mouse.x, mouse.y);
      await page.waitForTimeout(opts.pause ?? 700);
    },
  };

  await page.goto(BASE);
  await page.waitForSelector('.song-card');
  await page.mouse.move(mouse.x, mouse.y);
  await page.waitForTimeout(800);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1350, everyNthFrame: 1 });
  await page.waitForTimeout(400);
  await script(t);
  await cdp.send('Page.stopScreencast');

  const audio = (await page.evaluate('window.__stopAudioTaps()')) as { start: number; data: string }[];
  const tracks = audio.map((a, i) => {
    writeFileSync(`${dir}audio-${i}.webm`, Buffer.from(a.data, 'base64'));
    return { file: `audio-${i}.webm`, start: a.start };
  });
  writeFileSync(`${dir}frames.json`, JSON.stringify(frames));
  writeFileSync(`${dir}marks.json`, JSON.stringify({ marks, audio: tracks }, null, 2));
  await page.close();
  console.log(`${name}: ${frames.length} frames, ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)} s, ${tracks.length} audio track(s)`);
}

async function rendered(p: Page): Promise<void> {
  await p.waitForSelector('.at-host svg', { timeout: 20000 });
  await p.waitForSelector('.at-overlay.hidden', { state: 'attached', timeout: 20000 });
}
async function openSong(t: Take, title: string): Promise<void> {
  await t.click(`.song-card[data-title="${title}"] .card-link`, { pause: 200 });
  await rendered(t.page);
  await t.page.selectOption('footer select[title="Zoom"]', '1');
  await rendered(t.page);
  await t.page.waitForTimeout(500);
}
async function startPlaying(t: Take): Promise<void> {
  await t.click('button.play', { pause: 0 });
  await t.page.waitForFunction(() => (window as any).fretlane.at.playerState === 1, undefined, { polling: 'raf' });
}

// Reel 1: the whole band plays, and you pick which part to read.
await take('band', async (t) => {
  t.mark('library');
  await t.page.waitForTimeout(1200);
  await openSong(t, 'In the Hall of the Mountain King');
  t.mark('play');
  await startPlaying(t);
  t.mark('playing');
  await t.page.waitForTimeout(5500);
  t.mark('bass');
  await t.click('.track-list li:nth-child(3)', { pause: 200 });
  await rendered(t.page);
  await t.page.waitForTimeout(4200);
  t.mark('drums');
  await t.click('.track-list li:nth-child(4)', { pause: 200 });
  await rendered(t.page);
  await t.page.waitForTimeout(4200);
  t.mark('end');
});

// Reel 2: practice tools. Half speed, a loop over the tricky bars, the metronome.
await take('practice', async (t) => {
  await openSong(t, 'Für Elise');
  t.mark('play');
  await startPlaying(t);
  await t.page.waitForTimeout(4000);
  await t.click('button.play', { pause: 300 });
  t.mark('speed');
  await t.click('footer select[title="Playback speed"]', { pause: 300 });
  await t.page.selectOption('footer select[title="Playback speed"]', '0.5');
  await t.page.keyboard.press('Escape');
  await t.page.waitForTimeout(400);
  await t.click('button.play', { pause: 0 });
  await t.page.waitForTimeout(4500);
  await t.click('button.play', { pause: 300 });
  // Back to the top, then drag across bars 2-3 to select a range and loop it.
  t.mark('loop');
  await t.click('footer button[title="Back to start"]', { pause: 300 });
  await t.glide(540, 500);
  for (let i = 0; i < 6; i++) await t.page.mouse.wheel(0, -400), await t.page.waitForTimeout(60);
  await t.page.waitForTimeout(600);
  const bars = (await t.page.evaluate(() => {
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
  await t.glide(a.x + 12, y);
  await t.page.waitForTimeout(250);
  await t.page.mouse.down();
  await t.glide(b.x + b.w - 12, y);
  await t.page.mouse.up();
  await t.page.waitForTimeout(500);
  if (!(await t.page.evaluate(() => (window as any).fretlane.at.playbackRange))) throw new Error('no range selected');
  await t.click('footer button.toggle:has-text("Loop")', { pause: 300 });
  await t.click('button.play', { pause: 0 });
  // Proof the loop holds: the bar counter must jump back at least once.
  const seen: number[] = [];
  for (let i = 0; i < 24; i++) {
    seen.push(Number((await t.page.locator('.bar-pos').textContent())?.match(/\d+/)?.[0]));
    await t.page.waitForTimeout(500);
  }
  if (!seen.some((v, i) => i > 2 && v < seen[i - 1])) throw new Error(`loop did not repeat: ${seen.join(',')}`);
  console.log('loop bars', seen.join(','));
  await t.click('button.play', { pause: 300 });
  t.mark('metronome');
  await t.click('.topbar .metronome-btn', { pause: 700 });
  await t.click('.metronome-panel .song-tempo button', { pause: 500 });
  await t.click('.metronome-start', { pause: 3200 });
  t.mark('tap');
  for (let i = 0; i < 6; i++) await t.click('.metronome-panel button.tap', { pause: 330 });
  await t.page.waitForTimeout(2600);
  await t.click('.metronome-start', { pause: 500 });
  t.mark('end');
});

// Reel 3: paste a plain-text tab, get a playable tab. The riff is original.
const RIFF = `e|-----------------|-----------------|-----------------|-----------------|
B|-----------------|-----------------|-----------------|-----------------|
G|-----------------|-----------------|-----------------|---------2-------|
D|-------2---------|-------2---------|-------2---------|-----2-------2---|
A|---2-------2-0---|---2-------2-5---|---2-------2-0---|---2-----------0-|
E|-0---0-3-------3-|-0---0-3---------|-0---0-3-------3-|-0---------------|`;
await take('paste', async (t) => {
  t.mark('library');
  await t.page.waitForTimeout(900);
  await t.click('.topbar button.primary', { pause: 700 });
  await t.click('.segmented button:text-is("Paste text")', { pause: 500 });
  t.mark('paste');
  await t.click('dialog textarea', { pause: 300 });
  await t.page.locator('dialog textarea').fill(RIFF); // a paste is instant
  await t.page.waitForTimeout(1200);
  await t.click('dialog input[name="title"]', { pause: 200 });
  await t.page.locator('dialog input[name="title"]').pressSequentially('My riff', { delay: 70 });
  await t.page.waitForTimeout(500);
  await t.click('dialog button[type="submit"]', { pause: 0 });
  await t.page.waitForSelector('.song-card[data-title="My riff"]');
  await t.page.waitForTimeout(1000);
  t.mark('added');
  await openSong(t, 'My riff');
  t.mark('play');
  await startPlaying(t);
  t.mark('playing');
  await t.page.waitForTimeout(9000);
  t.mark('end');
});

// Reel 4: favorites and the archive ("learned it").
await take('archive', async (t) => {
  t.mark('library');
  await t.page.waitForTimeout(1000);
  t.mark('favorite');
  await t.click('.song-card[data-title="Greensleeves"] button.star', { pause: 900 });
  await t.click('.song-card[data-title="Canon in D"] button.star', { pause: 900 });
  await t.click('.view-bar [data-view="favorites"]', { pause: 1600 });
  await t.click('.view-bar [data-view="all"]', { pause: 700 });
  t.mark('done');
  await t.click('.song-card[data-title="Twinkle Twinkle Little Star"] button.done', { pause: 900 });
  await t.click('.song-card[data-title="Jingle Bells"] button.done', { pause: 900 });
  await t.click('.view-bar [data-view="archive"]', { pause: 2200 });
  t.mark('end');
});

await browser.close();
