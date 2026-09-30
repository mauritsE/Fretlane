/**
 * Add a song to a running Songstarr (npm run dev / npm start) from the command line.
 *
 *   npm run add-song -- <tab file or URL> [--title "..."] [--artist "..."] [--youtube <url>] [--tags a,b]
 *   npm run add-song -- ./tabs/my-song.gp5 --youtube https://youtu.be/XXXXXXXXXXX --tags rock
 *
 * Env: SONGSTARR_URL (default http://localhost:5173)
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { NewSongInput, Song } from '../shared/types.ts';

const BASE = process.env.SONGSTARR_URL ?? 'http://localhost:5173';
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

const input: NewSongInput = {
  title: opt('title'),
  artist: opt('artist'),
  youtube: opt('youtube'),
  tags: opt('tags')?.split(',').map((t) => t.trim()).filter(Boolean),
};
const source = args[0];
if (!source) {
  console.error('Usage: npm run add-song -- <tab file or URL> [--title T] [--artist A] [--youtube URL] [--tags a,b]');
  process.exit(1);
}
if (/^https?:\/\//.test(source)) input.tabUrl = source;
else if (existsSync(source)) input.tabFile = { name: path.basename(source), dataBase64: readFileSync(source).toString('base64') };
else {
  console.error(`Not a URL and no such file: ${source}`);
  process.exit(1);
}

try {
  const res = await fetch(`${BASE}/api/songs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const body = (await res.json()) as Song & { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  console.log(`Added "${body.title}" by ${body.artist} [${body.tabFormat}]${body.youtubeId ? ` with video ${body.youtubeId}` : ''}`);
  console.log(`Open: ${BASE}/#/song/${encodeURIComponent(body.id)}`);
} catch (err) {
  const msg = (err as Error).message;
  console.error(msg.includes('fetch failed') ? `Songstarr is not running at ${BASE}. Start it with "npm run dev" or "npm start".` : `Failed: ${msg}`);
  process.exit(1);
}
