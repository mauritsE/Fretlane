/**
 * A throwaway Fretlane for App Store screenshots and the preview: the real server and the built UI
 * (`npm run build` first) on a fresh library seeded with the bundled songs, plus a stand-in for
 * Fretlane Cloud, so the ☁ Cloud window can show a signed-in demo account without the real service.
 *
 * The demo cloud only lists the app's own original or public-domain tabs (files from demo/), and
 * its sign-in approves at once, the way the website's /connect page does after Google sign-in.
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirAssets, startServer } from '../server/app.ts';
import type { CloudTabRow } from '../shared/cloud.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_EMAIL = 'you@example.com';

const ROWS: (CloudTabRow & { file: string })[] = [
  { id: 'd1', title: 'Rotterdam Riff', artist: 'My band', file: 'rotterdam-riff.atex', youtube_url: null, spotify_url: null, sync_offset: 0 },
  { id: 'd2', title: 'Night Trail', artist: 'My band', file: 'night-trail.txt', youtube_url: null, spotify_url: null, sync_offset: 0 },
  { id: 'd3', title: 'Amazing Grace', artist: 'Traditional', file: 'amazing-grace.atex', youtube_url: null, spotify_url: null, sync_offset: 0 },
  { id: 'd4', title: 'First Steps', artist: null, file: 'first-steps.atex', youtube_url: null, spotify_url: null, sync_offset: 0 },
].map((r) => ({ ...r, file_path: `u/${r.file}`, format: path.extname(r.file).slice(1), updated_at: '' }));

export interface DemoEnv {
  base: string;
  libraryDir: string;
  /** Signs the app in to the demo cloud (the same calls the browser makes on the website). */
  signIn(): Promise<void>;
  close(): Promise<void>;
}

export async function startDemo(): Promise<DemoEnv> {
  const cloud = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    for await (const _ of req) void _;
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const session = { access_token: 'demo', refresh_token: 'demo', expires_in: 3600, user: { email: DEMO_EMAIL } };
    if (url.pathname === '/auth/v1/verify' || url.pathname === '/auth/v1/token') return json(200, session);
    if (url.pathname === '/auth/v1/logout') return json(204, {});
    if (url.pathname === '/rest/v1/tabs') {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      return json(200, ROWS.filter((r) => !id || r.id === id).map(({ file: _f, ...row }) => row));
    }
    const row = ROWS.find((r) => url.pathname === `/storage/v1/object/authenticated/tabs/${r.file_path}`);
    if (row) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(await fs.readFile(path.join(ROOT, 'demo', row.file)));
      return;
    }
    json(404, {});
  });
  await new Promise<void>((r) => cloud.listen(0, '127.0.0.1', r));
  const cloudUrl = `http://127.0.0.1:${(cloud.address() as { port: number }).port}`;

  const libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fretlane-appstore-'));
  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    libraryDir,
    assets: dirAssets(path.join(ROOT, 'dist')),
    seed: path.join(ROOT, 'demo'),
    cloud: { siteUrl: cloudUrl, apiUrl: cloudUrl, apiKey: 'demo' },
  });
  const base = server.url.replace(/\/$/, '');

  return {
    base,
    libraryDir,
    async signIn() {
      const login = await fetch(`${base}/api/cloud/login`, { method: 'POST', body: JSON.stringify({ origin: base }) });
      const { url } = (await login.json()) as { url: string };
      const state = new URL(url).searchParams.get('state')!;
      const back = await fetch(`${base}/api/cloud/callback?state=${encodeURIComponent(state)}&token_hash=demo`);
      if (!back.ok) throw new Error(`demo cloud sign-in failed: ${back.status}`);
    },
    async close() {
      await server.close();
      cloud.close();
      await fs.rm(libraryDir, { recursive: true, force: true });
    },
  };
}

/** Renders a song with Fretlane's own synthesizer to a 16-bit stereo WAV (see marketing/export-audio.ts). */
export async function renderSongWav(page: import('playwright').Page, base: string, songId: string): Promise<Buffer> {
  const sampleRate = 44100;
  await page.goto(`${base}/#/song/${songId}`);
  await page.waitForFunction(() => (window as any).fretlane?.at?.isReadyForPlayback, undefined, { timeout: 30000 });
  const b64 = await page.evaluate(async (rate) => {
    const at = (window as any).fretlane.at;
    const exporter = await at.exportAudio({ sampleRate: rate, useSyncPoints: false, masterVolume: 1, metronomeVolume: 0, trackVolume: new Map(), trackTranspositionPitches: new Map(), instrumentVolume: new Map() });
    const parts: Float32Array[] = [];
    for (;;) {
      const chunk = await exporter.render(1000);
      if (!chunk) break;
      parts.push(chunk.samples);
    }
    exporter.destroy();
    const total = parts.reduce((a, p) => a + p.length, 0);
    const pcm = new Int16Array(total);
    let o = 0;
    for (const p of parts) for (let i = 0; i < p.length; i++) pcm[o++] = Math.max(-32768, Math.min(32767, Math.round(p[i] * 32767)));
    let bin = '';
    const bytes = new Uint8Array(pcm.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, sampleRate);
  // One second of silence before bar 1, like a real recording, so the sync pin has something to do.
  const lead = Buffer.alloc(sampleRate * 4);
  const data = Buffer.concat([lead, Buffer.from(b64, 'base64')]);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
