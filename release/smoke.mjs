// Launches a packaged Songstarr executable the way a user would (fresh home folder) and checks it
// really works: the server answers, the UI is served, and the demo library is seeded.
// Dependency-free so CI can run it on any OS with plain Node:
//   node release/smoke.mjs <path/to/Songstarr[.exe]> [--arch x86_64]   (--arch: run via Rosetta on macOS)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const archIdx = args.indexOf('--arch');
const arch = archIdx >= 0 ? args.splice(archIdx, 2)[1] : undefined;
const exe = path.resolve(args[0] ?? '');
if (!args[0]) {
  console.error('Usage: node release/smoke.mjs <executable> [--arch x86_64]');
  process.exit(2);
}

const port = 5199;
const home = mkdtempSync(path.join(os.tmpdir(), 'songstarr-smoke-'));
const env = { ...process.env, HOME: home, USERPROFILE: home, SONGSTARR_PORT: String(port), SONGSTARR_NO_BROWSER: '1' };
delete env.SONGSTARR_LIBRARY;
const [cmd, cmdArgs] = arch ? ['arch', [`-${arch}`, exe]] : [exe, []];

let output = '';
let exited = null;
const child = spawn(cmd, cmdArgs, { env, cwd: path.dirname(exe) });
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));
child.on('exit', (code, signal) => (exited = signal ? `signal ${signal}` : `code ${code}`));
child.on('error', (e) => (exited = `spawn error: ${e.message}`));

function fail(msg) {
  console.error(`FAIL ${msg}\n--- executable output ---\n${output}`);
  child.kill();
  process.exit(1);
}

const base = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 60_000;
let health = null;
while (Date.now() < deadline) {
  if (exited) fail(`the app exited early (${exited})`);
  try {
    health = await (await fetch(`${base}/api/health`)).json();
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!health) fail('the app did not answer within 60s');
if (health.app !== 'songstarr') fail(`unexpected health response ${JSON.stringify(health)}`);

const page = await (await fetch(`${base}/`)).text();
if (!page.includes('<title>Songstarr</title>')) fail('the UI page was not served');
const songs = await (await fetch(`${base}/api/songs`)).json();
if (!Array.isArray(songs) || songs.length < 3) fail(`demo library not seeded (${JSON.stringify(songs).slice(0, 200)})`);
const tab = await fetch(`${base}/api/songs/${encodeURIComponent(songs[0].id)}/tab`);
if (!tab.ok) fail(`could not load a demo tab (${tab.status})`);
const sf = await fetch(`${base}/soundfont/sonivox.sf2`);
if (!sf.ok || (await sf.arrayBuffer()).byteLength < 100_000) fail('soundfont missing from the package');

console.log(`PASS ${path.basename(path.dirname(exe))}${arch ? ` (${arch})` : ''}: health ok, UI served, ${songs.length} demo songs, soundfont present`);
console.log(output.trim().split('\n').map((l) => `  | ${l}`).join('\n'));
child.kill();
rmSync(home, { recursive: true, force: true });
process.exit(0);
