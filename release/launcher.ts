/**
 * Entry point of the standalone Songstarr executable (built by release/build.ts with `bun build --compile`).
 * Double-clicking it starts the local server, opens the browser, and keeps running until the window
 * is closed. Everything a non-technical user sees here should be plain language.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { startServer, type StaticAssets } from '../server/app.ts';
import type { SeedSource } from '../server/library.ts';

export interface EmbeddedFiles {
  version: string;
  /** dist/ files, path -> base64 */
  assets: Record<string, string>;
  /** demo/ files, name -> base64 */
  demo: Record<string, string>;
}

const FIRST_PORT = 5173;
const PORT_ATTEMPTS = 20;

function mapAssets(files: Record<string, string>): StaticAssets {
  const cache = new Map<string, Uint8Array>();
  return {
    async get(rel) {
      const b64 = files[rel];
      if (b64 === undefined) return null;
      let data = cache.get(rel);
      if (!data) cache.set(rel, (data = new Uint8Array(Buffer.from(b64, 'base64'))));
      return data;
    },
  };
}

function mapSeed(files: Record<string, string>): SeedSource {
  return {
    async read(file) {
      const b64 = files[path.basename(file)];
      if (b64 === undefined) throw new Error(`Missing demo file ${file}`);
      return new Uint8Array(Buffer.from(b64, 'base64'));
    },
  };
}

export function defaultLibraryDir(): string {
  return process.env.SONGSTARR_LIBRARY ?? path.join(os.homedir(), 'Songstarr');
}

export function openBrowser(url: string): void {
  if (process.env.SONGSTARR_NO_BROWSER) return;
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' });
    child.on('error', () => console.log(`  (Could not open a browser automatically. Please open ${url} yourself.)`));
    child.unref();
  } catch {
    console.log(`  (Could not open a browser automatically. Please open ${url} yourself.)`);
  }
}

/** Is a Songstarr already answering on this port? Then we just open it instead of starting a second copy. */
async function isSongstarrRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return ((await res.json()) as { app?: string }).app === 'songstarr';
  } catch {
    return false;
  }
}

function waitForEnter(message: string): Promise<void> {
  if (!process.stdin.isTTY) return Promise.resolve();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(message, () => {
      rl.close();
      resolve();
    }),
  );
}

export async function runLauncher(files: EmbeddedFiles): Promise<void> {
  const libraryDir = defaultLibraryDir();
  const firstPort = Number(process.env.SONGSTARR_PORT ?? FIRST_PORT);
  console.log('');
  console.log(`  ♪ Songstarr ${files.version}`);
  console.log('  ─────────────────────────────');

  for (let port = firstPort; port < firstPort + PORT_ATTEMPTS; port++) {
    try {
      const server = await startServer({
        port,
        host: '127.0.0.1',
        libraryDir,
        assets: mapAssets(files.assets),
        seed: mapSeed(files.demo),
      });
      console.log(`  Songstarr is running at ${server.url}`);
      console.log(`  Your songs are saved in: ${libraryDir}`);
      console.log('');
      console.log('  Keep this window open while you play.');
      console.log('  To quit Songstarr, close this window (or press Ctrl+C).');
      console.log('');
      openBrowser(server.url);
      const stop = async () => {
        await server.close();
        process.exit(0);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') {
        console.error(`\n  Songstarr could not start: ${(err as Error).message}\n`);
        await waitForEnter('  Press Enter to close this window.');
        process.exit(1);
      }
      if (await isSongstarrRunning(port)) {
        const url = `http://localhost:${port}`;
        console.log(`  Songstarr is already running, opening ${url}`);
        openBrowser(url);
        setTimeout(() => process.exit(0), 1500);
        return;
      }
      // Port taken by another program: try the next one.
    }
  }
  console.error(`\n  Songstarr could not find a free port between ${firstPort} and ${firstPort + PORT_ATTEMPTS - 1}.\n`);
  await waitForEnter('  Press Enter to close this window.');
  process.exit(1);
}
