import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HttpError, Library, type SeedSource } from './library.ts';
import { fetchTab } from './fetchTab.ts';
import { MediaSearch } from './mediaSearch.ts';
import { FretlaneCloud } from './cloud.ts';
import { cloudTabToSongInput, summarizeCloudTab, type CloudConfig } from '../shared/cloud.ts';
import type { NewSongInput, SongPatch } from '../shared/types.ts';
import { APP_ID, APP_NAME } from '../shared/brand.ts';

const MAX_BODY = 30 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.ttf': 'font/ttf',
  '.sf2': 'application/octet-stream',
  '.sf3': 'application/octet-stream',
};

/** The built UI (Vite `dist/`), read from disk or from data embedded in the executable. */
export interface StaticAssets {
  /** `rel` is a URL path without the leading slash, e.g. "assets/index.js". Returns null when missing. */
  get(rel: string): Promise<Uint8Array | null>;
}

export function dirAssets(dir: string): StaticAssets {
  return {
    async get(rel) {
      const file = path.join(dir, rel);
      if (!file.startsWith(dir)) return null;
      try {
        const stat = await fs.stat(file);
        return stat.isFile() ? new Uint8Array(await fs.readFile(file)) : null;
      } catch {
        return null;
      }
    },
  };
}

export interface ServerOptions {
  port: number;
  host: string;
  libraryDir: string;
  /** Serve the UI too. Omit in dev mode, where Vite serves it. */
  assets?: StaticAssets;
  seed?: string | SeedSource;
  /** Fretlane Cloud endpoints; defaults to the real service (or FRETLANE_CLOUD_* overrides). */
  cloud?: CloudConfig;
}

export interface RunningServer {
  url: string;
  /** The port actually bound (differs from the requested one when port 0 was passed). */
  port: number;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const library = new Library(opts.libraryDir);
  await library.init(opts.seed);
  const mediaSearch = new MediaSearch(opts.libraryDir);
  await mediaSearch.init();
  const cloud = new FretlaneCloud(opts.libraryDir, opts.cloud);
  await cloud.init();

  async function readJson<T>(req: http.IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new HttpError(413, 'Request body too large');
      chunks.push(chunk as Buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
    } catch {
      throw new HttpError(400, 'Invalid JSON body');
    }
  }

  function send(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'songs', id?, 'tab'?]
    const method = req.method ?? 'GET';

    if (parts[1] === 'songs') {
      const id = parts[2] ? decodeURIComponent(parts[2]) : undefined;
      if (!id) {
        if (method === 'GET') return send(res, 200, library.list());
        if (method === 'POST') return send(res, 201, await library.add(await readJson<NewSongInput>(req)));
      } else if (parts[3] === 'tab' && method === 'GET') {
        const song = library.get(id);
        if (!song) throw new HttpError(404, 'Song not found');
        const data = await fs.readFile(library.tabPath(song));
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-cache' });
        res.end(data);
        return;
      } else if (!parts[3]) {
        if (method === 'GET') {
          const song = library.get(id);
          if (!song) throw new HttpError(404, 'Song not found');
          return send(res, 200, song);
        }
        if (method === 'PATCH') return send(res, 200, await library.update(id, await readJson<SongPatch>(req)));
        if (method === 'DELETE') {
          await library.remove(id);
          return send(res, 200, { ok: true });
        }
      }
    }

    // Preview a remote tab without saving it to the library.
    if (parts[1] === 'fetch' && method === 'GET') {
      const target = url.searchParams.get('url');
      if (!target) throw new HttpError(400, 'Missing ?url=');
      const { bytes, name } = await fetchTab(target, 20 * 1024 * 1024);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-tab-name': encodeURIComponent(name) });
      res.end(bytes);
      return;
    }

    // Find a recording for a song (results the user picks from; nothing is stored).
    if (parts[1] === 'search' && method === 'GET') {
      const source = url.searchParams.get('source');
      if (source !== 'youtube' && source !== 'spotify') throw new HttpError(400, 'source must be youtube or spotify');
      return send(res, 200, await mediaSearch.search(source, url.searchParams.get('q') ?? ''));
    }

    if (parts[1] === 'settings') {
      if (method === 'GET') return send(res, 200, mediaSearch.publicSettings());
      if (method === 'PUT') {
        const body = await readJson<{ spotifyClientId?: string; spotifyClientSecret?: string }>(req);
        return send(res, 200, await mediaSearch.setSpotifyCredentials(body.spotifyClientId ?? '', body.spotifyClientSecret ?? ''));
      }
    }

    if (parts[1] === 'cloud') return handleCloud(req, res, url, parts.slice(2), method);

    // `app` lets tools (and the smoke test) recognise this server.
    if (parts[1] === 'health') return send(res, 200, { ok: true, app: APP_ID, library: opts.libraryDir });
    throw new HttpError(404, 'Unknown API route');
  }

  async function handleCloud(req: http.IncomingMessage, res: http.ServerResponse, url: URL, parts: string[], method: string): Promise<void> {
    const [what, id, action] = parts;
    if (what === 'status' && method === 'GET') return send(res, 200, cloud.status());
    if (what === 'login' && method === 'POST') {
      // The UI tells us the origin it was loaded from; the browser comes back to that same server.
      const { origin } = await readJson<{ origin?: string }>(req);
      return send(res, 200, cloud.startLogin(`${origin ?? ''}/api/cloud/callback`));
    }
    if (what === 'callback' && method === 'GET') {
      // Opened in the user's web browser by the website, not by the app: answer with a page.
      const error = url.searchParams.get('error');
      try {
        if (error) throw new HttpError(400, error);
        const status = await cloud.finishLogin(url.searchParams.get('state') ?? '', url.searchParams.get('token_hash') ?? '');
        return sendPage(res, 200, 'Signed in', `${APP_NAME} is connected to Fretlane Cloud${status.email ? ` as ${status.email}` : ''}. You can close this tab and go back to ${APP_NAME}.`);
      } catch (err) {
        return sendPage(res, err instanceof HttpError ? err.status : 500, 'Sign-in failed', (err as Error).message);
      }
    }
    if (what === 'logout' && method === 'POST') return send(res, 200, await cloud.logout());
    if (what === 'tabs' && !id && method === 'GET') {
      const rows = await cloud.listTabs();
      return send(res, 200, rows.map((r) => summarizeCloudTab(r, library.findByCloudId(r.id)?.id ?? null)));
    }
    if (what === 'tabs' && id && action === 'import' && method === 'POST') {
      const tabId = decodeURIComponent(id);
      const existing = library.findByCloudId(tabId);
      if (existing) return send(res, 200, existing);
      const row = await cloud.getTab(tabId);
      return send(res, 201, await library.add(cloudTabToSongInput(row, await cloud.downloadTab(row))));
    }
    throw new HttpError(404, 'Unknown API route');
  }

  function sendPage(res: http.ServerResponse, status: number, title: string, message: string): void {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)} · ${esc(APP_NAME)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#16181d;color:#e6e8ee;display:grid;place-items:center;min-height:90vh;margin:0 16px}main{max-width:32em;text-align:center}h1{font-size:1.4em}</style>
<main><h1>${esc(title)}</h1><p>${esc(message)}</p></main>`);
  }

  async function serveStatic(res: http.ServerResponse, url: URL, assets: StaticAssets): Promise<void> {
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel.split('/').includes('..')) throw new HttpError(403, 'Forbidden');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    let data = await assets.get(rel);
    if (!data) {
      rel = 'index.html'; // SPA fallback
      data = await assets.get(rel);
    }
    if (!data) throw new HttpError(404, 'Not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(rel)] ?? 'application/octet-stream' });
    res.end(data);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (opts.assets) await serveStatic(res, url, opts.assets);
      else throw new HttpError(404, 'In dev mode the UI is served by Vite on http://localhost:5173');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: (err as Error).message });
      else res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const host = opts.host === '127.0.0.1' || opts.host === '0.0.0.0' ? 'localhost' : opts.host;
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  return {
    url: `http://${host}:${port}`,
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
