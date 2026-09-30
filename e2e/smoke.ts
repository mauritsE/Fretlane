/**
 * Browser smoke test against a running dev server (npm run dev):
 *   npx tsx e2e/smoke.ts [baseUrl]
 *
 * YouTube itself is replaced by a fake IFrame API (a simulated video clock) so the tab<->video
 * bridge can be tested offline and deterministically. Screenshots go to e2e/screenshots/.
 */
import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const FAKE_YT = `
(() => {
  class FakePlayer {
    constructor(el, opts) {
      this.t = 0; this.state = -1; this.rate = 1; this.vol = 100; this.opts = opts;
      const box = document.createElement('div');
      box.id = 'fake-yt'; box.textContent = 'FAKE VIDEO ' + opts.videoId;
      box.style.cssText = 'width:100%;height:100%;display:grid;place-items:center;color:#fff;background:#333';
      el.replaceWith(box);
      window.__fakeYT = this;
      setTimeout(() => opts.events.onReady && opts.events.onReady(), 50);
      setInterval(() => { if (this.state === 1) this.t += 0.05 * this.rate; }, 50);
    }
    _set(s) { this.state = s; this.opts.events.onStateChange && this.opts.events.onStateChange({ data: s }); }
    playVideo() { if (this.state !== 1) this._set(1); }
    pauseVideo() { if (this.state === 1) this._set(2); }
    seekTo(s) { this.t = s; }
    getCurrentTime() { return this.t; }
    getDuration() { return 120; }
    getPlayerState() { return this.state; }
    setPlaybackRate(r) { this.rate = r; }
    getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5]; }
    setVolume(v) { this.vol = v; }
    mute() {} unMute() {} destroy() {}
  }
  window.YT = { Player: FakePlayer, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
})();`;

let failures = 0;
function check(cond: boolean, msg: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function waitRendered(page: Page): Promise<void> {
  await page.waitForSelector('.at-surface svg, .at-surface-svg, .at-host svg', { timeout: 20000 });
  await page.waitForSelector('.at-overlay.hidden', { state: 'attached', timeout: 20000 });
}

// Use a pre-installed Chromium when Playwright's own download is not available (CHROMIUM_PATH overrides).
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
// Block the real YouTube script and provide the fake instead.
await page.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: `${FAKE_YT}; window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();` }));
await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404, body: '' }));

// ---------- library ----------
await page.goto(BASE);
await page.waitForSelector('.song-card');
const cards = await page.locator('.song-card').count();
check(cards >= 3, `library shows ${cards} songs`);
await page.fill('.search', 'rotterdam');
check((await page.locator('.song-card').count()) === 1, 'search filters to 1 song');
await page.screenshot({ path: `${SHOTS}01-library.png` });

// ---------- synth playback ----------
await page.locator('.song-card a.card-link').first().click();
await waitRendered(page);
const tracks = await page.locator('.track-list li').count();
check(tracks === 3, `multi-track demo lists ${tracks} tracks`);
await page.click('button.play');
await page.waitForTimeout(2500);
const synthPos = await page.evaluate(() => (window as any).fretlane.at.timePosition as number);
check(synthPos > 500, `synth playback advanced to ${Math.round(synthPos)}ms`);
await page.screenshot({ path: `${SHOTS}02-player-synth.png` });
await page.click('button.play');
// switch track
await page.locator('.track-list li').nth(1).click();
await waitRendered(page);
const rendered = await page.evaluate(() => (window as any).fretlane.at.tracks.map((t: any) => t.name));
check(rendered.join() === 'Bass', `switching tracks renders ${rendered}`);

// ---------- add a song with a (fake) YouTube video + pasted ASCII tab ----------
const song = await api<{ id: string; tabFormat: string }>('/api/songs', {
  method: 'POST',
  body: JSON.stringify({
    title: 'E2E Video Song',
    artist: 'Test',
    youtube: 'https://youtu.be/abcdefghijk?t=3',
    tags: ['e2e'],
    tabText: 'e|--0--3--|--5--7--|\nB|--1-----|--------|\nG|--------|--------|\nD|--------|--------|\nA|--------|--------|\nE|--------|--------|\n',
  }),
});
check(song.tabFormat === 'alphatex', 'pasted ASCII tab is converted to alphaTex');

await page.goto(`${BASE}/#/song/${song.id}`);
await waitRendered(page);
await page.waitForFunction(() => !!(window as any).__fakeYT);
check(await page.locator('#fake-yt').isVisible(), 'video panel shows the (fake) YouTube player');

// Playing from alphaTab must drive the video, and the video clock must drive the cursor.
await page.click('button.play');
await page.waitForTimeout(1500);
const s1 = await page.evaluate(() => ({ yt: (window as any).__fakeYT.t, at: (window as any).fretlane.at.timePosition, st: (window as any).__fakeYT.state }));
check(s1.st === 1, 'alphaTab play() started the video');
check(Math.abs(s1.at - s1.yt * 1000) < 200, `tab time follows video time (tab ${Math.round(s1.at)}ms vs video ${Math.round(s1.yt * 1000)}ms)`);

// Pausing from the video side must pause alphaTab.
await page.evaluate(() => (window as any).__fakeYT.pauseVideo());
await page.waitForTimeout(200);
const atState = await page.evaluate(() => (window as any).fretlane.at.playerState);
check(atState === 0, 'pausing the video pauses the tab');

// Sync: pin bar 1 to video time 2.0s -> tab time at video 2.0s must be ~0.
await page.evaluate(() => (window as any).__fakeYT.seekTo(2));
await page.click('text=⇆ Sync');
await page.fill('.sync-panel input[type=number]', '1');
await page.click('text=📌 Pin to video time');
await page.waitForTimeout(600);
const pinned = await api<{ syncPoints: { bar: number; time: number }[] }>(`/api/songs/${song.id}`);
check(pinned.syncPoints.length === 1 && Math.abs(pinned.syncPoints[0].time - 2) < 0.01, `sync pin saved (${JSON.stringify(pinned.syncPoints)})`);
await page.evaluate(() => (window as any).__fakeYT.seekTo(3));
await page.waitForTimeout(300);
const afterPin = await page.evaluate(() => (window as any).fretlane.at.timePosition as number);
check(Math.abs(afterPin - 1000) < 150, `with bar 1 pinned at 2.0s, video 3.0s maps to tab ${Math.round(afterPin)}ms (expected ~1000)`);

// Speed change propagates to the video.
await page.selectOption('footer select[title="Playback speed"]', '0.5');
await page.waitForTimeout(200);
const rate = await page.evaluate(() => (window as any).__fakeYT.rate);
check(rate === 0.5, `speed 50% is applied to the video (rate=${rate})`);

// Clicking a beat in the tab seeks the video.
await page.evaluate(() => (window as any).__fakeYT.seekTo(10));
const beatBox = await page.evaluate(() => {
  const at = (window as any).fretlane.at;
  const b = at.boundsLookup.staffSystems[0].bars[0].bars[0].beats[0].visualBounds;
  const r = at.container.element.getBoundingClientRect ? at.container.element.getBoundingClientRect() : document.querySelector('.at-host')!.getBoundingClientRect();
  return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 };
});
await page.mouse.click(beatBox.x, beatBox.y);
await page.waitForTimeout(300);
const ytAfterClick = await page.evaluate(() => (window as any).__fakeYT.t);
check(Math.abs(ytAfterClick - 2) < 0.1, `clicking bar 1 seeks the video to the pin (${ytAfterClick.toFixed(2)}s)`);
await page.screenshot({ path: `${SHOTS}03-player-video-sync.png` });

// cleanup
await api(`/api/songs/${song.id}`, { method: 'DELETE' });

const relevant = errors.filter((e) => !/favicon|ytimg|404/.test(e));
check(relevant.length === 0, `no page errors${relevant.length ? ': ' + relevant.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
