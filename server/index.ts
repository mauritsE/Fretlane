import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, Library } from './library.ts';
import { fetchTab } from './fetchTab.ts';
import type { NewSongInput, SongPatch } from '../shared/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SONGSTARR_PORT ?? (process.argv.includes('--serve-dist') ? 5173 : 5174));
// Bind to loopback only: this is a personal, local tool and the URL fetcher must not be exposed.
const HOST = process.env.SONGSTARR_HOST ?? '127.0.0.1';
const LIBRARY_DIR = path.resolve(process.env.SONGSTARR_LIBRARY ?? path.join(ROOT, 'library'));
const SERVE_DIST = process.argv.includes('--serve-dist');
const DIST_DIR = path.join(ROOT, 'dist');
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

const library = new Library(LIBRARY_DIR);

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
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-cache' });
      createReadStream(library.tabPath(song)).pipe(res);
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
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'x-tab-name': encodeURIComponent(name),
    });
    res.end(bytes);
    return;
  }

  if (parts[1] === 'health') return send(res, 200, { ok: true, library: LIBRARY_DIR });
  throw new HttpError(404, 'Unknown API route');
}

async function serveStatic(res: http.ServerResponse, url: URL): Promise<void> {
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  let file = path.join(DIST_DIR, rel);
  if (!file.startsWith(DIST_DIR)) throw new HttpError(403, 'Forbidden');
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(DIST_DIR, 'index.html'); // SPA fallback
  }
  const data = await fs.readFile(file);
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (SERVE_DIST) await serveStatic(res, url);
    else throw new HttpError(404, 'In dev mode the UI is served by Vite on http://localhost:5173');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: (err as Error).message });
    else res.end();
  }
});

await library.init(path.join(ROOT, 'demo'));
server.listen(PORT, HOST, () => {
  console.log(`Songstarr ${SERVE_DIST ? 'app' : 'API'} running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Library: ${LIBRARY_DIR}`);
});
