import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { HttpError, Library, type SeedSource } from './library.ts';
import { fetchTab } from './fetchTab.ts';
import { MediaSearch } from './mediaSearch.ts';
import { FretlaneCloud } from './cloud.ts';
import { RiffAssistant } from './assistant.ts';
import { CloudSync } from './cloudSync.ts';
import type { RiffRequest } from '../shared/editor/assistant.ts';
import { RIFF_STREAM_TYPE, isRiffStream, riffEventLine, type RiffEvent } from '../shared/editor/riffStream.ts';
import { cloudTabToSongInput, summarizeCloudTab, type CloudConfig } from '../shared/cloud.ts';
import type { PremiumStatus } from '../shared/premium.ts';
import type { NewSongInput, SongPatch } from '../shared/types.ts';
import { APP_ID, APP_NAME } from '../shared/brand.ts';
import { audioFormatOfFile, audioMime, parseByteRange } from '../shared/audio.ts';
import { refuseRequest } from '../shared/localGuard.ts';

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
      const inside = path.relative(dir, file);
      if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
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
  /** Quiet time (ms) after a change to a written song before it is backed up to Fretlane Cloud. */
  cloudSyncDelayMs?: number;
  /**
   * The tab editor is unlocked without checking for a plan. Set by the Mac App Store build only:
   * it is paid up front, and Apple doesn't allow unlocking features with an outside purchase.
   */
  premiumIncluded?: boolean;
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
  const assistant = new RiffAssistant(cloud);
  // Songs written in Fretlane are backed up to Fretlane Cloud while signed in; catch up on changes
  // made while signed out or offline.
  const cloudSync = new CloudSync(library, cloud, opts.cloudSyncDelayMs);
  cloudSync.syncAll();

  /** Fretlane Premium (the tab editor); `force` asks the website again instead of the cached answer. */
  async function premium(force = false): Promise<PremiumStatus> {
    if (opts.premiumIncluded) {
      const { email, siteUrl } = cloud.status();
      return { premium: true, reason: 'included', email, until: null, checkedAt: null, pricingUrl: new URL('/pricing', siteUrl).toString() };
    }
    return cloud.premium(force);
  }

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
        if (method === 'POST') {
          const input = await readJson<NewSongInput>(req);
          if (input.written) await requirePremium();
          const song = await library.add(input);
          cloudSync.schedule(song.id);
          return send(res, 201, song);
        }
      } else if (parts[3] === 'tab' && method === 'PUT') {
        // The tab editor's save: raw alphaTex, not JSON.
        await requirePremium();
        const song = await library.setTab(id, req);
        cloudSync.schedule(song.id);
        return send(res, 200, song);
      } else if (parts[3] === 'tab' && method === 'GET') {
        const song = library.get(id);
        if (!song) throw new HttpError(404, 'Song not found');
        const data = await fs.readFile(library.tabPath(song));
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-cache' });
        res.end(data);
        return;
      } else if (parts[3] === 'audio') {
        if (method === 'PUT') {
          const raw = String(req.headers['x-file-name'] ?? 'audio');
          let name = raw;
          try {
            name = decodeURIComponent(raw);
          } catch {
            /* not percent-encoded: keep it as sent */
          }
          return send(res, 200, await library.setAudio(id, name, req));
        }
        if (method === 'GET' || method === 'HEAD') {
          const song = library.get(id);
          const file = song && library.audioPath(song);
          if (!file) throw new HttpError(404, 'This song has no audio file');
          return sendFile(req, res, file, audioMime(audioFormatOfFile(file) ?? 'mp3'));
        }
      } else if (!parts[3]) {
        if (method === 'GET') {
          const song = library.get(id);
          if (!song) throw new HttpError(404, 'Song not found');
          return send(res, 200, song);
        }
        if (method === 'PATCH') {
          const song = await library.update(id, await readJson<SongPatch>(req));
          cloudSync.schedule(song.id);
          return send(res, 200, song);
        }
        if (method === 'DELETE') {
          await library.remove(id);
          cloudSync.cancel(id);
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

    // Fretlane Premium (the tab editor). POST asks the website again instead of using the cached answer.
    if (parts[1] === 'premium' && (method === 'GET' || method === 'POST')) return send(res, 200, await premium(method === 'POST'));

    // The songwriting assistant in the tab editor (Premium, like the editor itself).
    if (parts[1] === 'assistant' && parts[2] === 'status' && method === 'GET') return send(res, 200, await assistant.status());
    if (parts[1] === 'assistant' && parts[2] === 'riff' && method === 'POST') {
      await requirePremium();
      const body = await readJson<RiffRequest>(req);
      if (!isRiffStream(req.headers.accept)) return send(res, 200, await assistant.riff(body));
      return streamRiff(res, body);
    }

    // `app` lets tools (and the smoke test) recognise this server.
    if (parts[1] === 'health') return send(res, 200, { ok: true, app: APP_ID, library: opts.libraryDir });
    throw new HttpError(404, 'Unknown API route');
  }

  /**
   * The assistant's answer as NDJSON events (shared/editor/riffStream.ts), so the editor shows
   * Claude writing. Errors known up front still get their status; later ones arrive as an event.
   * Closing the request (the editor's Stop) stops the Claude call.
   */
  async function streamRiff(res: http.ServerResponse, body: RiffRequest): Promise<void> {
    assistant.check(body);
    const stop = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) stop.abort();
    });
    res.writeHead(200, { 'content-type': `${RIFF_STREAM_TYPE}; charset=utf-8`, 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
    res.flushHeaders();
    const write = (e: RiffEvent) => {
      if (!res.destroyed) res.write(riffEventLine(e));
    };
    try {
      write({ type: 'done', ...(await assistant.riff(body, write, stop.signal)) });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      write({ type: 'error', status, error: (err as Error).message });
    }
    res.end();
  }

  async function handleCloud(req: http.IncomingMessage, res: http.ServerResponse, url: URL, parts: string[], method: string): Promise<void> {
    const [what, id, action] = parts;
    if (what === 'status' && method === 'GET') return send(res, 200, cloud.status());
    if (what === 'login' && method === 'POST') {
      // The browser comes back to the server the UI was loaded from (the guard checked the Host).
      return send(res, 200, cloud.startLogin(`http://${req.headers.host}/api/cloud/callback`));
    }
    if (what === 'callback' && method === 'GET') {
      // Opened in the user's web browser by the website, not by the app: answer with a page.
      const error = url.searchParams.get('error');
      try {
        if (error) throw new HttpError(400, error);
        const status = await cloud.finishLogin(url.searchParams.get('state') ?? '', url.searchParams.get('token_hash') ?? '');
        cloudSync.syncAll();
        return sendPage(res, 200, 'Signed in', `${APP_NAME} is connected to Fretlane Cloud${status.email ? ` as ${status.email}` : ''}. You can close this tab and go back to ${APP_NAME}.`);
      } catch (err) {
        return sendPage(res, err instanceof HttpError ? err.status : 500, 'Sign-in failed', (err as Error).message);
      }
    }
    if (what === 'logout' && method === 'POST') {
      cloudSync.cancel();
      return send(res, 200, await cloud.logout());
    }
    // How the Fretlane Cloud backup of a written song stands (the editor shows it).
    if (what === 'sync' && id && method === 'GET') return send(res, 200, cloudSync.status(decodeURIComponent(id)));
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

  /** Writing songs needs Fretlane Premium. The UI checks first; this keeps the API honest too. */
  async function requirePremium(): Promise<void> {
    const status = await premium();
    if (status.premium) return;
    throw new HttpError(
      402,
      status.reason === 'signed-out'
        ? 'Writing songs is part of Fretlane Premium. Sign in to Fretlane Cloud first.'
        : status.reason === 'offline'
          ? 'Could not check your Fretlane Premium plan. Are you online?'
          : 'Writing songs is part of Fretlane Premium, which comes with the Fretlane Cloud plan.',
    );
  }

  function sendPage(res: http.ServerResponse, status: number, title: string, message: string): void {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)} · ${esc(APP_NAME)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#16181d;color:#e6e8ee;display:grid;place-items:center;min-height:90vh;margin:0 16px}main{max-width:32em;text-align:center}h1{font-size:1.4em}</style>
<main><h1>${esc(title)}</h1><p>${esc(message)}</p></main>`);
  }

  /** Sends a file with HTTP range support; `<audio>` needs ranges to seek. */
  async function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, type: string): Promise<void> {
    const { size } = await fs.stat(file);
    const range = parseByteRange(req.headers.range, size);
    const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
    if (range === 'unsatisfiable') {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
      res.end();
      return;
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    res.writeHead(range ? 206 : 200, {
      ...headers,
      'content-length': String(end - start + 1),
      ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === 'HEAD' || size === 0) {
      res.end();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(file, { start, end });
      stream.on('error', reject);
      res.on('close', () => {
        stream.destroy();
        resolve();
      });
      stream.pipe(res);
    });
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
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      const refused = refuseRequest({
        path: url.pathname,
        host: req.headers.host,
        origin: req.headers.origin,
        fetchSite: req.headers['sec-fetch-site'] as string | undefined,
      });
      if (refused) throw new HttpError(403, refused);
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
    close: () =>
      new Promise((resolve) => {
        cloudSync.close();
        server.close(() => resolve());
      }),
  };
}
