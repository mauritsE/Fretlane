// Launches a packaged Fretlane desktop app (with its own temporary library and profile) and checks it
// really works: the window loads the UI, the local server answers, the demo library is seeded and
// the soundfont is packaged. Dependency-free so CI can run it on any OS with plain Node:
//   node release/smoke.mjs <path/to/app executable> [--arch x86_64] [-- extra app args]
//   (--arch runs it via Rosetta on macOS; on Linux run under xvfb-run and pass -- --no-sandbox)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const dashDash = argv.indexOf('--');
const appArgs = dashDash >= 0 ? argv.splice(dashDash).slice(1) : [];
const archIdx = argv.indexOf('--arch');
const arch = archIdx >= 0 ? argv.splice(archIdx, 2)[1] : undefined;
if (!argv[0]) {
  console.error('Usage: node release/smoke.mjs <executable> [--arch x86_64] [-- app args]');
  process.exit(2);
}
const exe = path.resolve(argv[0]);

const port = 5199;
// Isolate the run with its own library and profile folders. The real home folder is left alone:
// faking HOME/USERPROFILE crashes Chromium on Windows (0x80000003), and macOS ignores it anyway.
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fretlane-smoke-'));
const env = {
  ...process.env,
  FRETLANE_PORT: String(port),
  FRETLANE_SMOKE: '1',
  FRETLANE_LIBRARY: path.join(tmp, 'library'),
  FRETLANE_USER_DATA: path.join(tmp, 'profile'),
  // Chromium/Electron logs go to stderr, so a crash leaves evidence in the output.
  ELECTRON_ENABLE_LOGGING: '1',
  ELECTRON_ENABLE_STACK_DUMPING: '1',
};
delete env.SONGSTARR_LIBRARY;
const allArgs = [...appArgs, '--enable-logging=stderr'];
const [cmd, cmdArgs] = arch ? ['arch', [`-${arch}`, exe, ...allArgs]] : [exe, allArgs];

let output = '';
let exited = null;
// On macOS/Linux start it in its own process group so the helpers can be stopped with it.
const child = spawn(cmd, cmdArgs, { env, cwd: path.dirname(exe), detached: process.platform !== 'win32' });
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));
child.on('exit', (code, signal) => (exited = signal ? `signal ${signal}` : `code ${code}`));
child.on('error', (e) => (exited = `spawn error: ${e.message}`));

/** Stops the app and all of its helper processes (GPU, renderer...). */
function killTree() {
  if (exited) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

async function finish(code, msg) {
  console[code ? 'error' : 'log'](msg);
  if (code) console.error(`--- app output ---\n${output.slice(-6000)}`);
  killTree();
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows may still hold files for a moment */
  }
  process.exit(code);
}
const fail = (msg) => finish(1, `FAIL ${msg}`);

// Wait until the window reports it has loaded the UI (the app prints FRETLANE_READY <url>).
const deadline = Date.now() + 90_000;
while (!/FRETLANE_READY/.test(output)) {
  if (exited) await fail(`the app exited before its window loaded (${exited})`);
  if (Date.now() > deadline) await fail('the app window did not load within 90s');
  await new Promise((r) => setTimeout(r, 300));
}

const base = `http://127.0.0.1:${port}`;
let health;
try {
  health = await (await fetch(`${base}/api/health`)).json();
} catch (e) {
  await fail(`the library server did not answer on ${base}: ${e.message}`);
}
if (health.app !== 'fretlane') await fail(`unexpected health response ${JSON.stringify(health)}`);
const page = await (await fetch(`${base}/`)).text();
if (!page.includes('<title>Fretlane</title>')) await fail('the UI page was not served');
const songs = await (await fetch(`${base}/api/songs`)).json();
if (!Array.isArray(songs) || songs.length < 3) await fail(`demo library not seeded (${JSON.stringify(songs).slice(0, 200)})`);
const tab = await fetch(`${base}/api/songs/${encodeURIComponent(songs[0].id)}/tab`);
if (!tab.ok) await fail(`could not load a demo tab (${tab.status})`);
const sf = await fetch(`${base}/soundfont/sonivox.sf2`);
if (!sf.ok || (await sf.arrayBuffer()).byteLength < 100_000) await fail('soundfont missing from the package');

await finish(0, `PASS ${path.basename(exe)}${arch ? ` (${arch})` : ''}: window loaded, server ok, ${songs.length} demo songs, soundfont present`);
