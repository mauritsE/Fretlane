/**
 * Browser smoke test against a running dev server (npm run dev):
 *   npx tsx e2e/smoke.ts [baseUrl]
 *
 * YouTube itself is replaced by a fake IFrame API (a simulated video clock) so the tab<->video
 * bridge can be tested offline and deterministically. Screenshots go to e2e/screenshots/.
 */
import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as alphaTab from '@coderline/alphatab';
import { FAKE_YT } from './fakes.ts';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

// Mimics Spotify's iFrame API: position reports only every 500 ms, play() restarts from the top,
// and a seek before the first play is ignored, like the real embed.
const FAKE_SPOTIFY = `
(() => {
  class FakeController {
    constructor(el, opts) {
      this.t = 0; this.paused = true; this.everPlayed = false; this.listeners = {}; this.opts = opts; this.seeksIgnored = 0;
      const box = document.createElement('div');
      box.id = 'fake-sp'; box.textContent = 'FAKE SPOTIFY ' + opts.uri;
      box.style.cssText = 'width:100%;height:152px;display:grid;place-items:center;color:#fff;background:#1db954';
      el.replaceWith(box);
      window.__fakeSP = this;
      setTimeout(() => this._emit('ready'), 50);
      setInterval(() => { if (!this.paused) this.t = Math.min(this.t + 0.05, 200); }, 50);
      setInterval(() => this._update(), 500);
    }
    addListener(ev, cb) { (this.listeners[ev] = this.listeners[ev] || []).push(cb); }
    _emit(ev, data) { (this.listeners[ev] || []).forEach((cb) => cb({ data })); }
    _update() { this._emit('playback_update', { isPaused: this.paused, isBuffering: false, duration: 200000, position: Math.round(this.t * 1000) }); }
    play() { this.t = 0; this.paused = false; this.everPlayed = true; this._update(); }
    resume() { this.paused = false; this.everPlayed = true; this._update(); }
    pause() { this.paused = true; this._update(); }
    seek(s) { if (!this.everPlayed) { this.seeksIgnored++; return; } this.t = s; this._update(); }
    destroy() {}
  }
  window.onSpotifyIframeApiReady && window.onSpotifyIframeApiReady({ createController: (el, opts, cb) => cb(new FakeController(el, opts)) });
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

/** A mono 16-bit WAV with a short click every half second. */
function clickTrackWav(seconds: number, rate = 22050): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const inClick = i % (rate / 2) < rate * 0.01;
    b.writeInt16LE(inClick ? Math.round(12000 * Math.sin((2 * Math.PI * 1000 * i) / rate)) : 0, 44 + i * 2);
  }
  return b;
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
await page.route('https://open.spotify.com/embed/iframe-api/v1', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_SPOTIFY }));
await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404, body: '' }));

// ---------- library ----------
await page.goto(BASE);
await page.waitForSelector('.song-card');
const cards = await page.locator('.song-card').count();
check(cards >= 23, `library shows ${cards} songs (demos + songbook)`);
await page.screenshot({ path: `${SHOTS}01-library.png` });

// ---------- favorites + archive ----------
const card = (title: string) => page.locator(`.song-card[data-title="${title}"]`);
const count = async (view: string) => Number(await page.locator(`.view-bar [data-view="${view}"] .count`).textContent());
const favBefore = await count('favorites');
await card('Greensleeves').locator('button.star').click();
await page.waitForFunction((n) => Number(document.querySelector('.view-bar [data-view="favorites"] .count')?.textContent) === n + 1, favBefore);
check((await page.locator('.song-card').first().getAttribute('data-title')) === 'Greensleeves', 'a favorite moves to the top of the library');
await page.click('.view-bar [data-view="favorites"]');
check((await page.locator('.song-card').count()) === favBefore + 1, 'Favorites view lists the starred song');
await page.click('.view-bar [data-view="all"]');
await page.screenshot({ path: `${SHOTS}01a-favorite.png` });
await card('Greensleeves').locator('button.star').click(); // leave the library as we found it
await page.waitForFunction((n) => Number(document.querySelector('.view-bar [data-view="favorites"] .count')?.textContent) === n, favBefore);

const allBefore = await count('all');
await card('Twinkle Twinkle Little Star').locator('button.done').click();
await page.waitForFunction((n) => Number(document.querySelector('.view-bar [data-view="all"] .count')?.textContent) === n - 1, allBefore);
check((await card('Twinkle Twinkle Little Star').count()) === 0, 'a song marked done leaves the library view');
await page.click('.view-bar [data-view="archive"]');
check((await card('Twinkle Twinkle Little Star').locator('.card-done').count()) === 1, 'the archive shows it with its done date');
await page.screenshot({ path: `${SHOTS}01b-archive.png` });
await card('Twinkle Twinkle Little Star').locator('button.restore').click();
await page.waitForFunction((n) => Number(document.querySelector('.view-bar [data-view="all"] .count')?.textContent) === n, allBefore);
check((await count('archive')) === 0, 'restoring brings it back from the archive');
await page.click('.view-bar [data-view="all"]');

// ---------- metronome ----------
await page.keyboard.press('m');
await page.waitForSelector('.metronome-panel');
await page.click('.metronome-panel button.icon.big[title="Faster"]');
const bpmShown = Number(await page.locator('.bpm-value').textContent());
await page.click('.metronome-start');
await page.waitForTimeout(1500);
const metro = await page.evaluate(() => ({ running: (window as any).fretlaneMetronome.running, scheduled: (window as any).fretlaneMetronome.scheduled }));
check(metro.running && metro.scheduled >= 2, `metronome clicks (${metro.scheduled} clicks at ${bpmShown} BPM)`);
check((await page.locator('.beat-dots .dot.on').count()) === 1, 'metronome lights the current beat');
await page.screenshot({ path: `${SHOTS}01c-metronome.png` });
for (const _ of [0, 1, 2, 3]) {
  await page.click('.metronome-panel button.tap');
  await page.waitForTimeout(400);
}
const tapped = Number(await page.locator('.bpm-value').textContent());
check(tapped >= 130 && tapped <= 170, `tap tempo at 400 ms per tap gives ${tapped} BPM (about 150)`);
await page.click('.metronome-start');
check(!(await page.evaluate(() => (window as any).fretlaneMetronome.running)), 'metronome stops');
await page.keyboard.press('m');

await page.fill('.search', 'rotterdam');
check((await page.locator('.song-card').count()) === 1, 'search filters to 1 song');

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

// ---------- songbook: every bundled song renders and a band arrangement plays ----------
const all = await api<{ id: string; title: string; tags: string[] }[]>('/api/songs');
for (const s of all.filter((x) => x.tags.includes('songbook') || x.tags.includes('demo'))) {
  await page.goto(`${BASE}/#/song/${s.id}`);
  await waitRendered(page);
  const info = await page.evaluate(() => ({ bars: (window as any).fretlane.at.score?.masterBars.length ?? 0, tracks: document.querySelectorAll('.track-list li').length }));
  check(info.bars > 0 && info.tracks > 0, `"${s.title}" renders (${info.bars} bars, ${info.tracks} tracks)`);
  // Every track must render on its own too (drum tracks once crashed alphaTab in the Tab view).
  for (let i = 1; i < info.tracks; i++) {
    await page.locator('.track-list li').nth(i).click();
    await waitRendered(page);
  }
}
const workerErrors = errors.filter((e) => /unexpected error/.test(e));
check(workerErrors.length === 0, `every track of every song renders${workerErrors.length ? `: ${workerErrors[0].slice(0, 120)}` : ''}`);
const king = all.find((x) => x.title === 'In the Hall of the Mountain King')!;
await page.goto(`${BASE}/#/`);
{
  const [download] = await Promise.all([page.waitForEvent('download'), page.click(`.song-card[data-title="${king.title}"] button.download`)]);
  const gp = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(await readFile((await download.path())!)), new alphaTab.Settings());
  check(download.suggestedFilename() === `${king.title}.gp` && gp.tracks.length === 4, 'a library card downloads the song as a Guitar Pro file');
}
await page.goto(`${BASE}/#/song/${king.id}`);
await waitRendered(page);
check((await page.locator('.track-list li').count()) === 4, 'band arrangement has melody, rhythm, bass and drums');
{
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.topbar button:has-text(".gp")')]);
  const bytes = new Uint8Array(await readFile((await download.path())!));
  const gp = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, new alphaTab.Settings());
  check(
    download.suggestedFilename() === `${king.title}.gp` && gp.tracks.length === 4 && gp.title === king.title,
    'the player downloads the song as a Guitar Pro file alphaTab can open again',
  );
}
await page.click('button.play');
await page.waitForTimeout(2000);
check((await page.evaluate(() => (window as any).fretlane.at.timePosition as number)) > 500, 'songbook song plays');
await page.click('button.play');
await page.click('.topbar .star-toggle');
await page.waitForTimeout(300);
check((await api<{ favorite: boolean }>(`/api/songs/${king.id}`)).favorite, 'the player can star a song');
await page.keyboard.press('m');
await page.waitForSelector('.metronome-panel .song-tempo button');
await page.click('.metronome-panel .song-tempo button');
check((await page.locator('.bpm-value').textContent()) === '100', 'metronome takes the song tempo');
await page.screenshot({ path: `${SHOTS}02b-songbook-metronome.png` });
await page.keyboard.press('m');
await page.click('.topbar .star-toggle');

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

// Moving the paused video past the end of the tab (an outro) must not snap it back to bar 1.
await page.evaluate(() => (window as any).__fakeYT.pauseVideo());
await page.evaluate(() => (window as any).__fakeYT.seekTo(100));
await page.waitForTimeout(400);
const ytOutro = await page.evaluate(() => (window as any).__fakeYT.t as number);
check(ytOutro === 100, `seeking the paused video past the end of the tab stays there (${ytOutro}s)`);
await page.mouse.click(beatBox.x, beatBox.y);
await page.waitForTimeout(300);
check(Math.abs((await page.evaluate(() => (window as any).__fakeYT.t)) - 2) < 0.1, 'clicking a bar after that still seeks the video');

// cleanup
await api(`/api/songs/${song.id}`, { method: 'DELETE' });

// ---------- a song that plays along with a (fake) Spotify track ----------
const SP_ID = '4uLU6hMCjMI75M1A2tKUQC';
const spSong = await api<{ id: string; youtubeId: string; spotifyId: string }>('/api/songs', {
  method: 'POST',
  body: JSON.stringify({
    title: 'E2E Spotify Song',
    artist: 'Test',
    media: `https://open.spotify.com/intl-nl/track/${SP_ID}?si=abc`,
    tabText: 'e|--0--3--|--5--7--|--0--3--|--5--7--|\nB|--1-----|--------|--1-----|--------|\nG|--------|--------|--------|--------|\nD|--------|--------|--------|--------|\nA|--------|--------|--------|--------|\nE|--------|--------|--------|--------|\n',
  }),
});
check(spSong.spotifyId === SP_ID && spSong.youtubeId === '', 'a Spotify link is stored as the song recording');

await page.goto(`${BASE}/#/`);
await page.waitForSelector(`.song-card[data-title="E2E Spotify Song"] .badge.sp`);
check(true, 'library card shows the Spotify badge');

const spPage = `${BASE}/#/song/${spSong.id}`;
await page.goto(spPage);
await waitRendered(page);
await page.waitForFunction(() => !!(window as any).__fakeSP);
check(await page.locator('#fake-sp').isVisible(), 'player shows the (fake) Spotify embed');
check((await page.locator('.video-toolbar span').first().textContent()) === 'Spotify', 'panel is labelled Spotify');
check(await page.locator('footer select[title*="playback speed"]').isDisabled(), 'speed is locked for Spotify (the embed has no speed control)');

await page.click('button.play');
await page.waitForTimeout(1600);
// Sample within one 500 ms report window: the cursor must keep moving between reports.
const samples: number[] = [];
for (let i = 0; i < 5; i++) {
  samples.push(await page.evaluate(() => (window as any).fretlane.at.timePosition as number));
  await page.waitForTimeout(80);
}
const sp1 = await page.evaluate(() => ({ sp: (window as any).__fakeSP.t, at: (window as any).fretlane.at.timePosition, paused: (window as any).__fakeSP.paused }));
check(!sp1.paused, 'alphaTab play() started the Spotify track');
check(Math.abs(sp1.at - sp1.sp * 1000) < 250, `tab time follows Spotify time (tab ${Math.round(sp1.at)}ms vs track ${Math.round(sp1.sp * 1000)}ms)`);
check(samples.every((v, i) => i === 0 || v > samples[i - 1]), `cursor moves smoothly between position reports (${samples.map(Math.round).join(', ')})`);

await page.evaluate(() => (window as any).__fakeSP.pause());
await page.waitForTimeout(200);
check((await page.evaluate(() => (window as any).fretlane.at.playerState)) === 0, 'pausing Spotify pauses the tab');

// Pin bar 1 to 2.0 s in the track.
await page.evaluate(() => (window as any).__fakeSP.seek(2));
await page.waitForTimeout(100);
await page.click('text=⇆ Sync');
check((await page.locator('.sync-panel h3').textContent()) === 'Sync tab ⇆ track', 'sync panel talks about the track');
check((await page.locator('.sync-panel .waveform').count()) === 0, 'no waveform for Spotify (its audio cannot be decoded)');
await page.fill('.sync-panel input[type=number]', '1');
await page.click('text=📌 Pin to track time');
await page.waitForTimeout(600);
const spPinned = await api<{ syncPoints: { bar: number; time: number }[] }>(`/api/songs/${spSong.id}`);
check(spPinned.syncPoints.length === 1 && Math.abs(spPinned.syncPoints[0].time - 2) < 0.05, `Spotify sync pin saved (${JSON.stringify(spPinned.syncPoints)})`);
await page.evaluate(() => (window as any).__fakeSP.seek(3));
await page.waitForTimeout(300);
const spAfterPin = await page.evaluate(() => (window as any).fretlane.at.timePosition as number);
check(Math.abs(spAfterPin - 1000) < 150, `with bar 1 pinned at 2.0s, track 3.0s maps to tab ${Math.round(spAfterPin)}ms (expected ~1000)`);
await page.screenshot({ path: `${SHOTS}04-player-spotify.png` });

// Fresh page: Spotify ignores a seek before the first play, so playing from a clicked bar must still start there.
await page.goto('about:blank');
await page.goto(spPage);
await waitRendered(page);
await page.waitForFunction(() => !!(window as any).__fakeSP);
await page.waitForTimeout(300);
const bar2 = await page.evaluate(() => {
  const at = (window as any).fretlane.at;
  const b = at.boundsLookup.staffSystems[0].bars[1].bars[0].beats[0].visualBounds;
  const r = document.querySelector('.at-host')!.getBoundingClientRect();
  return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 };
});
await page.mouse.click(bar2.x, bar2.y);
await page.waitForTimeout(200);
const bar2Ms = await page.evaluate(() => (window as any).fretlane.at.timePosition as number);
await page.click('button.play');
await page.waitForTimeout(1200);
const fromBar2 = await page.evaluate(() => ({ sp: (window as any).__fakeSP.t }));
const expectStart = 2 + bar2Ms / 1000;
check(fromBar2.sp > expectStart + 0.5 && fromBar2.sp < expectStart + 1.8, `first play starts from the clicked bar (track at ${fromBar2.sp.toFixed(2)}s, bar starts at ${expectStart.toFixed(2)}s)`);
await page.evaluate(() => (window as any).__fakeSP.pause());

await api(`/api/songs/${spSong.id}`, { method: 'DELETE' });

// ---------- a song that plays along with the user's own audio file ----------
// A real WAV in the real <audio> element: unlike YouTube and Spotify, nothing here is faked.
await page.goto(`${BASE}/#/`);
await page.click('button:has-text("+ Add song")');
await page.click('dialog.song-dialog .segmented button:has-text("Paste text")');
await page.fill('dialog.song-dialog textarea', 'e|--0--3--|--5--7--|--0--3--|--5--7--|--0--3--|--5--7--|\nB|--1-----|--------|--1-----|--------|--1-----|--------|\nG|--------|--------|--------|--------|--------|--------|\nD|--------|--------|--------|--------|--------|--------|\nA|--------|--------|--------|--------|--------|--------|\nE|--------|--------|--------|--------|--------|--------|\n');
await page.fill('input[name=title]', 'E2E Audio Song');
await page.fill('input[name=artist]', 'Test');
await page.setInputFiles('#song-audio', { name: 'my band - take 3.wav', mimeType: 'audio/wav', buffer: clickTrackWav(20) });
check((await page.locator('.audio-chip-name').textContent()) === '🎵 my band - take 3.wav', 'the dialog shows the chosen audio file');
check(await page.locator('#song-recording').isDisabled(), 'the link field is disabled while an audio file is chosen');
await page.screenshot({ path: `${SHOTS}07-add-audio-file.png` });
await page.click('dialog.song-dialog button[type=submit]');
await page.waitForSelector('.song-card[data-title="E2E Audio Song"] .badge.audio');
check(true, 'library card shows the Audio badge');
const auSong = (await api<{ id: string; title: string; audioFile: string; audioName: string; youtubeId: string }[]>('/api/songs')).find((s) => s.title === 'E2E Audio Song')!;
check(auSong.audioFile === `${auSong.id}.wav` && auSong.audioName === 'my band - take 3.wav' && !auSong.youtubeId, `audio file stored with the song (${auSong.audioFile})`);

const ranged = await fetch(`${BASE}/api/songs/${auSong.id}/audio`, { headers: { range: 'bytes=100-199' } });
check(ranged.status === 206 && ranged.headers.get('content-range') === `bytes 100-199/${clickTrackWav(20).length}` && (await ranged.arrayBuffer()).byteLength === 100, 'audio is served with byte ranges (needed to seek)');

await page.goto(`${BASE}/#/song/${auSong.id}`);
await waitRendered(page);
await page.waitForFunction(() => ((document.querySelector('.video-box audio') as HTMLAudioElement | null)?.duration ?? 0) > 19);
check((await page.locator('.video-toolbar span').first().textContent()) === 'Audio file', 'panel is labelled Audio file');
check(!(await page.locator('footer select[title="Playback speed"]').isDisabled()), 'speed can be changed for an audio file');
const audio = (fn: string) => page.evaluate(`(() => { const a = document.querySelector('.video-box audio'); return ${fn}; })()`);

await page.click('button.play');
await page.waitForTimeout(1500);
const au1 = (await audio('({ t: a.currentTime, paused: a.paused, at: window.fretlane.at.timePosition })')) as { t: number; paused: boolean; at: number };
check(!au1.paused && au1.t > 0.8, `alphaTab play() started the audio file (at ${au1.t.toFixed(2)}s)`);
check(Math.abs(au1.at - au1.t * 1000) < 150, `tab time follows the audio (tab ${Math.round(au1.at)}ms vs audio ${Math.round(au1.t * 1000)}ms)`);

await page.selectOption('footer select[title="Playback speed"]', '0.5');
await page.waitForTimeout(200);
const r0 = (await audio('({ rate: a.playbackRate, pitch: a.preservesPitch, t: a.currentTime })')) as { rate: number; pitch: boolean; t: number };
await page.waitForTimeout(1000);
const r1 = (await audio('a.currentTime')) as number;
check(r0.rate === 0.5 && r0.pitch, 'speed 50% slows the audio down (pitch preserved)');
check(r1 - r0.t > 0.35 && r1 - r0.t < 0.7, `audio advances at half speed (${(r1 - r0.t).toFixed(2)}s in 1s)`);

await audio('a.pause()');
await page.waitForTimeout(200);
check((await page.evaluate(() => (window as any).fretlane.at.playerState)) === 0, 'pausing the audio pauses the tab');

// Clicking a bar seeks the audio: needs range requests to work.
await page.selectOption('footer select[title="Playback speed"]', '1');
const bar3 = await page.evaluate(() => {
  const at = (window as any).fretlane.at;
  const b = at.boundsLookup.staffSystems[0].bars[2].bars[0].beats[0].visualBounds;
  const r = document.querySelector('.at-host')!.getBoundingClientRect();
  return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 };
});
await page.mouse.click(bar3.x, bar3.y);
await page.waitForTimeout(300);
const seek = (await audio('({ t: a.currentTime, at: window.fretlane.at.timePosition })')) as { t: number; at: number };
check(seek.at > 500 && Math.abs(seek.t * 1000 - seek.at) < 100, `clicking bar 3 seeks the audio (audio ${seek.t.toFixed(2)}s, tab ${Math.round(seek.at)}ms)`);

// Pin bar 1 to 1.0 s.
await audio('(a.currentTime = 1, 0)');
await page.waitForTimeout(200);
await page.click('text=⇆ Sync');
check((await page.locator('.sync-panel h3').textContent()) === 'Sync tab ⇆ recording', 'sync panel talks about the recording');
await page.fill('.sync-panel input[type=number]', '1');
await page.click('text=📌 Pin to recording time');
await page.waitForTimeout(600);
const auPinned = await api<{ syncPoints: { bar: number; time: number }[] }>(`/api/songs/${auSong.id}`);
check(auPinned.syncPoints.length === 1 && Math.abs(auPinned.syncPoints[0].time - 1) < 0.05, `audio sync pin saved (${JSON.stringify(auPinned.syncPoints)})`);
await audio('(a.currentTime = 2.5, 0)');
await page.waitForTimeout(300);
const auAfterPin = await page.evaluate(() => (window as any).fretlane.at.timePosition as number);
check(Math.abs(auAfterPin - 1500) < 100, `with bar 1 pinned at 1.0s, audio 2.5s maps to tab ${Math.round(auAfterPin)}ms (expected ~1500)`);

// ---------- the waveform for placing pins (decodes the same WAV: clicks every 0.5 s, 10 ms long) ----------
await page.waitForSelector('.sync-panel .waveform[data-state=ready]', { timeout: 10000 });
check(true, 'the sync panel shows a waveform for an audio file');
const view = async () => page.evaluate(() => {
  const w = document.querySelector('.waveform') as HTMLElement;
  return { from: Number(w.dataset.from), to: Number(w.dataset.to) };
});
// Colour of the detail canvas at a time (seconds) and height (-1 bottom … 1 top).
const pixelAt = (t: number, y: number) =>
  page.evaluate(([t, y]) => {
    const w = document.querySelector('.waveform') as HTMLElement;
    const c = w.querySelector('canvas.wave-detail') as HTMLCanvasElement;
    const from = Number(w.dataset.from), to = Number(w.dataset.to);
    const x = Math.round(((t - from) / (to - from)) * c.width);
    const py = Math.round((c.height / 2) * (1 - y));
    return Array.from(c.getContext('2d')!.getImageData(x, py, 1, 1).data);
  }, [t, y] as const);
const clickWave = async (t: number, opts: { alt?: boolean; canvas?: string } = {}) => {
  const canvas = page.locator(opts.canvas ?? 'canvas.wave-detail');
  const box = (await canvas.boundingBox())!;
  const { from, to } = opts.canvas ? { from: 0, to: 20 } : await view();
  await canvas.click({ position: { x: ((t - from) / (to - from)) * box.width, y: box.height / 2 }, modifiers: opts.alt ? ['Alt'] : [] });
  await page.waitForTimeout(250);
};
await page.waitForTimeout(100);
const v0 = await view();
check(Math.abs(v0.from - 0.5) < 0.01 && Math.abs(v0.to - 4.5) < 0.01, `a 4 s window is centred on the playhead at 2.5 s (${v0.from}–${v0.to})`);
const isAccent = (p: number[]) => p[0] > 200 && p[1] > 140 && p[1] < 210 && p[2] < 110;
const isPlayhead = (p: number[]) => p[0] > 200 && p[1] < 120 && p[2] < 120;
const isWave = (p: number[]) => p[3] > 0 && !isAccent(p) && !isPlayhead(p);
check(isWave(await pixelAt(1.505, 0.3)) && isWave(await pixelAt(2.005, -0.3)), 'the clicks in the recording are drawn as peaks');
check((await pixelAt(1.25, 0.3))[3] === 0, 'silence between the clicks is drawn flat');
check(isAccent(await pixelAt(1.0, 0.9)), 'the pin on bar 1 (1.0 s) is drawn on the waveform');
check(isPlayhead(await pixelAt(2.5, 0.9)), 'the playhead is drawn at the current time');

await clickWave(3.03);
const snapped = (await audio('a.currentTime')) as number;
check(Math.abs(snapped - 3.0) < 0.006, `clicking just after a note snaps to its attack (clicked 3.03 s, moved to ${snapped.toFixed(3)} s)`);
await page.fill('.sync-panel input[type=number]', '3');
await page.click('text=📌 Pin to recording time');
await page.waitForTimeout(600);
const wavePins = (await api<{ syncPoints: { bar: number; time: number }[] }>(`/api/songs/${auSong.id}`)).syncPoints;
check(wavePins.length === 2 && wavePins[1].bar === 2 && Math.abs(wavePins[1].time - 3.0) < 0.006, `bar 3 pinned on the attack from the waveform (${JSON.stringify(wavePins)})`);

await clickWave(3.53, { alt: true });
const exact = (await audio('a.currentTime')) as number;
check(Math.abs(exact - 3.53) < 0.03, `Alt-click moves to the exact spot without snapping (${exact.toFixed(3)} s)`);
await clickWave(3.27);
check(Math.abs(((await audio('a.currentTime')) as number) - 3.27) < 0.03, 'a click in silence (no note nearby) stays where it was clicked');

await clickWave(10, { canvas: 'canvas.wave-overview' });
const jumped = (await audio('a.currentTime')) as number;
check(Math.abs(jumped - 10) < 0.2, `clicking the overview jumps through the song (${jumped.toFixed(2)} s)`);
await page.click('.waveform button[data-zoom=in]');
await page.waitForTimeout(100);
const v1 = await view();
check(Math.abs(v1.to - v1.from - 2) < 0.01 && Math.abs(v1.from - 9) < 0.05, `zoom in shows 2 s around the playhead (${v1.from}–${v1.to})`);
await page.click('.waveform button[data-zoom=out]');
await page.screenshot({ path: `${SHOTS}08-player-audio.png` });

// The edit dialog shows the file; removing it and pasting a link replaces the recording.
await page.click('header button:has-text("Edit")');
check((await page.locator('.audio-chip-name').textContent()) === '🎵 my band - take 3.wav', 'the edit dialog shows the current audio file');
await page.click('.audio-chip button:has-text("Remove")');
await page.fill('#song-recording', 'https://youtu.be/dQw4w9WgXcQ');
await Promise.all([page.waitForEvent('load'), page.click('dialog.song-dialog button[type=submit]')]);
const auLinked = await api<{ audioFile: string; youtubeId: string }>(`/api/songs/${auSong.id}`);
check(auLinked.audioFile === '' && auLinked.youtubeId === 'dQw4w9WgXcQ', 'replacing the audio file with a YouTube link removes the file');
check((await fetch(`${BASE}/api/songs/${auSong.id}/audio`)).status === 404, 'the old audio file is gone');

const notAudio = await fetch(`${BASE}/api/songs/${auSong.id}/audio`, { method: 'PUT', body: '%PDF-1.7 definitely not audio', headers: { 'x-file-name': 'fake.mp3' } });
check(notAudio.status === 415, `uploading a non-audio file is refused (${notAudio.status})`);
await api(`/api/songs/${auSong.id}`, { method: 'DELETE' });

// ---------- find a recording from the song dialog ----------
// The real server answers Spotify (no credentials here, so it asks for them without going online).
// YouTube is blocked in sandboxes, so its answer is faked at the browser: this tests the dialog,
// not YouTube's search endpoint.
const spNoCreds = await api<{ results: unknown[]; error?: string; openUrl: string }>('/api/search?source=spotify&q=pink%20floyd');
check(!!spNoCreds.error?.includes('Client ID') && spNoCreds.openUrl.startsWith('https://open.spotify.com/search/'), 'Spotify search without credentials explains the setup and links to Spotify');
const searched: string[] = [];
await page.route(/\/api\/search\?source=youtube/, (r) => {
  const q = new URL(r.request().url()).searchParams.get('q') ?? '';
  searched.push(q);
  const yt = (id: string, title: string, artist: string, duration: number, cleanArtist?: string) =>
    ({ source: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}`, title, artist, duration, thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, cleanArtist });
  return r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      openUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
      results: [yt('IXdNnw99-Ic', 'Wish You Were Here', 'Pink Floyd - Topic', 334, 'Pink Floyd'), yt('hjpF8ukSrvk', 'Wish You Were Here - Guitar Lesson', 'Teacher', 900)],
    }),
  });
});
await page.goto(`${BASE}/#/`);
await page.click('button:has-text("+ Add song")');
await page.fill('input[name=title]', 'Wish You Were Here');
await page.click('.recording-row button');
await page.waitForSelector('.picker-result');
check(searched.at(-1) === 'Wish You Were Here', `Find searches for the title when artist is empty ("${searched.at(-1)}")`);
check((await page.locator('.picker-result').count()) === 2 && (await page.locator('.picker-result .badge').first().textContent()) === 'Best match', 'results are listed with the best match marked');
await page.screenshot({ path: `${SHOTS}05-find-recording.png` });
await page.click('.media-picker button[data-source=spotify]');
await page.waitForSelector('.spotify-setup');
check(((await page.locator('.picker-open').getAttribute('href')) ?? '').startsWith('https://open.spotify.com/search/'), 'Spotify tab shows the one-time setup and a link to search on Spotify');
await page.screenshot({ path: `${SHOTS}06-find-spotify-setup.png` });
await page.click('.media-picker button[data-source=youtube]');
await page.waitForSelector('.picker-result');
await page.locator('.picker-result').first().click();
check((await page.inputValue('#song-recording')) === 'https://www.youtube.com/watch?v=IXdNnw99-Ic', 'picking a result fills in the YouTube link');
check((await page.inputValue('input[name=artist]')) === 'Pink Floyd', 'the artist is copied from the Topic channel');
check((await page.locator('.picker-host').innerHTML()) === '' && /✓ YouTube video/.test((await page.locator('.recording-field .hint').textContent()) ?? ''), 'the picker closes and the link is recognised');
await page.fill('#song-recording', 'gymnopedie satie');
await page.press('#song-recording', 'Enter');
await page.waitForSelector('.picker-result');
check(searched.at(-1) === 'gymnopedie satie' && (await page.locator('dialog.song-dialog').isVisible()), 'words + Enter in the Recording field search instead of submitting');
await page.click('dialog.song-dialog button:has-text("Cancel")');

const relevant = errors.filter((e) => !/favicon|ytimg|404/.test(e));
check(relevant.length === 0, `no page errors${relevant.length ? ': ' + relevant.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
