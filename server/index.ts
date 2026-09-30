/** Server entry for `npm run dev` (API only) and `npm start` (`--serve-dist`: API + built UI). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirAssets, startServer } from './app.ts';
import { APP_NAME, envVar } from '../shared/brand.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVE_DIST = process.argv.includes('--serve-dist');

const server = await startServer({
  port: Number(envVar('PORT') ?? (SERVE_DIST ? 5173 : 5174)),
  // Bind to loopback only: this is a personal, local tool and the URL fetcher must not be exposed.
  host: envVar('HOST') ?? '127.0.0.1',
  libraryDir: path.resolve(envVar('LIBRARY') ?? path.join(ROOT, 'library')),
  assets: SERVE_DIST ? dirAssets(path.join(ROOT, 'dist')) : undefined,
  seed: path.join(ROOT, 'demo'),
});
console.log(`${APP_NAME} ${SERVE_DIST ? 'app' : 'API'} running at ${server.url}`);
