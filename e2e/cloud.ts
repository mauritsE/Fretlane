/**
 * Browser test of Fretlane Cloud, against a fake website + fake Supabase (the real ones are not
 * reachable from CI or sandboxes). Needs a built UI (`npm run build`):
 *   npx tsx e2e/cloud.ts
 *
 * Covers: sign-in through the website's /connect page and the loopback callback, the cloud tab list,
 * importing a tab (with its YouTube link and offset), "Open" for an already imported tab, staying
 * signed in across a restart, and signing out. It does not prove the real website's /connect page or
 * Supabase accept these requests; check that by hand against the live site.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirAssets, startServer, type RunningServer } from '../server/app.ts';
import type { CloudConfig, CloudTabRow } from '../shared/cloud.ts';
import { FAKE_YT } from './fakes.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'e2e', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const ASCII = ['e|--0--3--5--|', 'B|--1--0--3--|', 'G|--0--0--2--|', 'D|--2--0--0--|', 'A|--3--2-----|', 'E|-----3-----|'].join('\n');

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
}

// ---------- fake website + Supabase on one port ----------
const rows: CloudTabRow[] = [
  { id: 'c1', title: 'Cloud Riff', artist: 'Tester', file_path: 'u1/a.txt', format: 'txt', spotify_url: null, youtube_url: 'https://youtu.be/dQw4w9WgXcQ', sync_offset: 1.5, updated_at: '' },
  { id: 'c2', title: 'Spotify Only', artist: null, file_path: 'u1/b.txt', format: 'txt', spotify_url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', youtube_url: null, sync_offset: 0, updated_at: '' },
];
const access = new Set<string>();
const refresh = new Set<string>();
let n = 0;
const issued = () => {
  n++;
  access.add(`a${n}`);
  refresh.add(`r${n}`);
  return { access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 3600, user: { email: 'player@example.com' } };
};
const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let body = '';
  for await (const c of req) body += c;
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (url.pathname === '/connect') {
    // The real page asks the user to sign in with Google and approve; here one click approves.
    const back = new URL(url.searchParams.get('return')!);
    back.searchParams.set('state', url.searchParams.get('state')!);
    back.searchParams.set('token_hash', 'hash-ok');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<a id="approve" href="${back.toString().replace(/"/g, '&quot;')}">Connect</a>`);
    return;
  }
  if (req.headers.apikey !== 'pk') return json(401, { msg: 'no apikey' });
  const b = body ? (JSON.parse(body) as Record<string, string>) : {};
  if (url.pathname === '/auth/v1/verify') return b.token_hash === 'hash-ok' ? json(200, issued()) : json(403, { msg: 'invalid' });
  if (url.pathname === '/auth/v1/token') return refresh.delete(b.refresh_token) ? json(200, issued()) : json(400, { error_description: 'Invalid Refresh Token' });
  if (url.pathname === '/auth/v1/logout') return json(204, {});
  if (!access.has(String(req.headers.authorization).replace('Bearer ', ''))) return json(401, { message: 'JWT expired' });
  if (url.pathname === '/rest/v1/tabs') {
    const id = url.searchParams.get('id')?.replace('eq.', '');
    return json(200, id ? rows.filter((r) => r.id === id) : rows);
  }
  if (url.pathname.startsWith('/storage/v1/object/authenticated/tabs/')) {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(ASCII);
    return;
  }
  json(404, {});
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
const fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
const cloud: CloudConfig = { siteUrl: fakeUrl, apiUrl: fakeUrl, apiKey: 'pk' };

// ---------- Fretlane ----------
const libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fretlane-cloud-e2e-'));
const start = () => startServer({ port: 0, host: '127.0.0.1', libraryDir, assets: dirAssets(path.join(ROOT, 'dist')), cloud });
let server: RunningServer = await start();

const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1400, height: 880 } });
await context.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: `${FAKE_YT}; window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();` }));
await context.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404, body: '' }));
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(server.url);
await page.waitForSelector('.topbar .account-chip:not(.hidden)');
check(((await page.locator('.account-chip').textContent()) ?? '') === 'Sign in', 'not signed in: the top bar offers Sign in');
await page.click('button.cloud-button');
await page.waitForSelector('.cloud-dialog a.button.primary');
check(/Sign in to Fretlane Cloud/.test((await page.locator('.cloud-dialog a.button.primary').textContent()) ?? ''), 'not signed in: the dialog offers sign-in');
await page.screenshot({ path: path.join(SHOTS, 'cloud-1-signin.png') });

// The link opens the website in a new tab (in the desktop app: the normal browser).
const [site] = await Promise.all([context.waitForEvent('page'), page.click('.cloud-dialog a.button.primary')]);
await site.waitForLoadState();
await site.click('#approve');
await site.waitForLoadState();
const callbackText = (await site.textContent('body')) ?? '';
check(/connected to Fretlane Cloud as player@example\.com/.test(callbackText), 'the callback page confirms the sign-in');
await site.close();

await page.waitForSelector('.cloud-tab', { timeout: 10000 });
check((await page.locator('.cloud-tab').count()) === 2, 'the dialog updates by itself and lists the cloud tabs');
check(/player@example\.com/.test((await page.locator('.cloud-account').textContent()) ?? ''), 'shows who is signed in');
check(((await page.locator('.account-chip.signed-in .account-name').textContent()) ?? '') === 'player@example.com', 'the top bar shows the account as soon as the sign-in lands');
await page.screenshot({ path: path.join(SHOTS, 'cloud-2-list.png') });

await page.click('.cloud-tab[data-cloud-id="c1"] button.primary');
await page.waitForURL(/#\/song\//);
const songs = (await (await fetch(`${server.url}/api/songs`)).json()) as { id: string; title: string; youtubeId: string; cloudId?: string; syncPoints: unknown[]; tabFormat: string }[];
const imported = songs.find((s) => s.cloudId === 'c1');
check(!!imported && imported.title === 'Cloud Riff' && imported.youtubeId === 'dQw4w9WgXcQ' && imported.tabFormat === 'alphatex', 'Add & open imports the tab with its YouTube video');
check(JSON.stringify(imported?.syncPoints) === JSON.stringify([{ bar: 0, time: 1.5 }]), 'the website offset becomes a sync pin on bar 1');
check(page.url().endsWith(`#/song/${encodeURIComponent(imported?.id ?? '')}`), 'and opens it in the player');
await page.waitForSelector('.at-surface svg, .at-surface-svg, .at-host svg', { timeout: 20000 });
check(await page.locator('#fake-yt').isVisible(), 'the player shows the linked video');
await page.screenshot({ path: path.join(SHOTS, 'cloud-3-player.png') });

// Restart: the session survives (refresh token in cloud.json), and the imported tab is recognised.
await server.close();
server = await start();
await page.goto(server.url);
await page.waitForSelector('.account-chip.signed-in');
check(/player@example\.com/.test((await page.locator('.account-chip').getAttribute('title')) ?? ''), 'after a restart: the top bar still shows who is signed in');
await page.screenshot({ path: path.join(SHOTS, 'cloud-4-account.png'), clip: { x: 0, y: 0, width: 1400, height: 60 } });
await page.click('button.cloud-button');
await page.waitForSelector('.cloud-tab');
check(((await page.locator('.cloud-tab[data-cloud-id="c1"] button.primary').textContent()) ?? '') === 'Open', 'after a restart: still signed in, and the imported tab says Open');
await page.click('.cloud-tab[data-cloud-id="c1"] button.primary');
await page.waitForURL(/#\/song\//);
const after = (await (await fetch(`${server.url}/api/songs`)).json()) as { cloudId?: string }[];
check(after.filter((s) => s.cloudId === 'c1').length === 1, 'opening it again does not import a duplicate');

await page.goto(server.url);
await page.click('button.cloud-button');
await page.waitForSelector('.cloud-account button');
await page.click('.cloud-account button');
await page.waitForSelector('.cloud-dialog a.button.primary');
check(!existsSync(path.join(libraryDir, 'cloud.json')), 'sign out forgets the session');
await page.waitForSelector('.account-chip:not(.signed-in):not(.hidden)');
check(((await page.locator('.account-chip').textContent()) ?? '') === 'Sign in', 'after sign out the top bar offers Sign in again');

// A callback nobody started is refused.
const forged = await fetch(`${server.url}/api/cloud/callback?state=forged&token_hash=hash-ok`);
check(forged.status === 400 && !existsSync(path.join(libraryDir, 'cloud.json')), 'a callback with an unknown state is refused');

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
await server.close();
fake.close();
await fs.rm(libraryDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
