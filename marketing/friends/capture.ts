/**
 * Real screenshots of the tab editor for the "tell your friends" kit: an original 4-bar riff
 * (guitar, bass, drums) opened in the editor, once on the guitar track (with a prompt typed into the
 * riff assistant, never sent) and once on the drum track.
 *
 * The app is real; the Fretlane Cloud account is not. A small fake website + Supabase signs the app in
 * as writer@example.com with an active $5 plan and 0 of 96 assistant bars used, the same way
 * e2e/editor.ts does. Nothing is sent to Claude, so no assistant answer is shown anywhere.
 * Needs a built UI (`npm run build`):
 *
 *   npx tsx marketing/friends/capture.ts   -> marketing/work/friends/editor-*.png
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirAssets, startServer } from '../../server/app.ts';
import { DRUM_TUNING, drumLane, type DocBar, type DocBeat, type DocNote, type SongDoc } from '../../shared/editor/doc.ts';
import { docToTex } from '../../shared/editor/tex.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'marketing/work/friends');
mkdirSync(OUT, { recursive: true });

const eighths = (notes: (DocNote[] | null)[]): DocBeat[] => notes.map((n) => ({ duration: 8, notes: n ?? [] }));
const g = (fret: number, string = 6, palmMute = false): DocNote[] => [{ string, fret, palmMute }];
const power = (fret: number): DocNote[] => [{ string: 5, fret: fret + 2 }, { string: 6, fret }];
const b = (fret: number): DocNote[] => [{ string: 4, fret }];
const d = (...ids: string[]): DocNote[] => ids.map((id) => ({ string: drumLane(id), fret: 0 }));

// An original riff in E minor: palm-muted chugs answered by power chords.
const guitar: DocBeat[][] = [
  eighths([g(0, 6, true), g(0, 6, true), power(3), g(0, 6, true), g(0, 6, true), power(5), g(0, 6, true), power(3)]),
  eighths([g(0, 6, true), g(0, 6, true), power(7), g(0, 6, true), power(5), null, power(3), g(2)]),
  eighths([g(0, 6, true), g(0, 6, true), power(3), g(0, 6, true), g(0, 6, true), power(5), g(0, 6, true), power(3)]),
  eighths([power(8), null, power(7), null, power(5), power(5), power(3), g(2)]),
];
const bass: DocBeat[][] = [
  eighths([b(0), b(0), b(3), b(0), b(0), b(5), b(0), b(3)]),
  eighths([b(0), b(0), b(7), b(0), b(5), null, b(3), b(2)]),
  eighths([b(0), b(0), b(3), b(0), b(0), b(5), b(0), b(3)]),
  eighths([b(8), null, b(7), null, b(5), b(5), b(3), b(2)]),
];
const beat = eighths([d('kick', 'closedHiHat'), d('closedHiHat'), d('snare', 'closedHiHat'), d('kick', 'closedHiHat'), d('kick', 'closedHiHat'), d('closedHiHat'), d('snare', 'closedHiHat'), d('closedHiHat')]);
const fill = eighths([d('kick', 'crash'), d('closedHiHat'), d('snare', 'closedHiHat'), d('kick'), d('highTom'), d('midTom'), d('floorTom'), d('snare')]);
const drums = [beat, beat, beat, fill];
// Twice through: eight bars, so the score wraps onto several lines.
for (const part of [guitar, bass, drums]) part.push(...part.slice(0, 4));

const doc: SongDoc = {
  title: 'Trail Run',
  artist: 'Fretlane demo',
  tempo: 128,
  tracks: [
    { name: 'Guitar', kind: 'guitar', sound: 'distortionguitar', tuning: [64, 59, 55, 50, 45, 40] },
    { name: 'Bass', kind: 'bass', sound: 'electricbassfinger', tuning: [43, 38, 33, 28] },
    { name: 'Drums', kind: 'drums', sound: 'percussion', tuning: DRUM_TUNING },
  ],
  bars: guitar.map((gb, i): DocBar => ({ ts: [4, 4], section: i === 0 ? 'Riff' : undefined, tracks: [gb, bass[i], drums[i]] })),
};

// ---------- fake Fretlane Cloud: a signed-in account with the $5 plan ----------
const session = () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { email: 'writer@example.com', id: 'user-w' } });
const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  for await (const _ of req) void _;
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (url.pathname === '/auth/v1/token') return json(200, session());
  if (url.pathname === '/auth/v1/user') return json(200, session().user);
  if (url.pathname === '/rest/v1/subscriptions') return json(200, [{ status: 'active', current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString() }]);
  if (url.pathname === '/rest/v1/rpc/my_kofi_membership') return json(200, null);
  if (url.pathname === '/rest/v1/tabs') return json(200, req.method === 'GET' ? [] : [{ id: 'cloud-1' }]);
  if (url.pathname.startsWith('/storage/v1/')) return json(200, { Key: 'ok' });
  if (url.pathname === '/api/public/app/riff-assistant' && req.method === 'GET') return json(200, { usage: { plan: 'Fretlane Cloud', used: 0, allowance: 96, resetsOn: '2026-11-01T00:00:00.000Z' } });
  json(404, { message: 'not in the fake' });
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
const fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;

const lib = await fs.mkdtemp(path.join(os.tmpdir(), 'fretlane-friends-'));
await fs.writeFile(path.join(lib, 'cloud.json'), JSON.stringify({ refreshToken: 'r', email: 'writer@example.com', userId: 'user-w' }), { mode: 0o600 });
const server = await startServer({ port: 0, host: '127.0.0.1', libraryDir: lib, assets: dirAssets(path.join(ROOT, 'dist')), seed: path.join(ROOT, 'demo'), cloud: { siteUrl: fakeUrl, apiUrl: fakeUrl, apiKey: 'pk' } });
const res = await fetch(`${server.url}/api/songs`, { method: 'POST', body: JSON.stringify({ title: doc.title, artist: doc.artist, written: true, tabText: docToTex(doc) }) });
if (!res.ok) throw new Error(`creating the song failed: ${res.status} ${await res.text()}`);
const { id } = (await res.json()) as { id: string };

const exe = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await page.goto(`${server.url}/#/write/${encodeURIComponent(id)}`);
await page.waitForSelector('.editor-overlay .caret', { timeout: 20000 });
await page.waitForSelector('.ai-meter:not(.hidden)', { timeout: 15000 });
await page.fill('.ai-prompt', 'A bass line and drums that follow this riff');
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'editor-guitar.png') });

await page.click('.sidebar .track-list li >> nth=2');
await page.waitForSelector('.editor-overlay .caret-label', { timeout: 10000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'editor-drums.png') });

await browser.close();
await server.close();
fake.close();
console.log(`wrote ${OUT}/editor-guitar.png and editor-drums.png`);
