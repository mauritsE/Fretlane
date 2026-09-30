import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HttpError, Library, type SeedSource } from './library.ts';
import { fetchTab } from './fetchTab.ts';
import type { NewSongInput, SongPatch } from '../shared/types.ts';

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
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const library = new Library(opts.libraryDir);
  await library.init(opts.seed);

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

    // `app` lets the launcher recognise an already-running Songstarr on this port.
    if (parts[1] === 'health') return send(res, 200, { ok: true, app: 'songstarr', library: opts.libraryDir });
    throw new HttpError(404, 'Unknown API route');
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
  return {
    url: `http://${host}:${opts.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
