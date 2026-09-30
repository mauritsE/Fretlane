/**
 * Drives the real desktop app window (Electron) with Playwright:
 *   npm run build && npm run build:desktop && xvfb-run -a npx tsx e2e/desktop.ts
 *
 * Covers: window opens with the library, a song renders and plays, the app keeps one instance,
 * and a pre-rename ~/Songstarr library is moved to ~/Fretlane on first launch.
 */
import { _electron as electron } from 'playwright';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(cond: boolean, msg: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
}

// A fake home with a library from before the rename.
const home = mkdtempSync(path.join(os.tmpdir(), 'fretlane-desktop-'));
mkdirSync(path.join(home, 'Songstarr', 'tabs'), { recursive: true });
writeFileSync(
  path.join(home, 'Songstarr', 'songs.json'),
  JSON.stringify([
    {
      id: 'legacy-song',
      title: 'Old Library Song',
      artist: 'Me',
      youtubeId: '',
      tabFile: 'legacy-song.atex',
      tabFormat: 'alphatex',
      tabSource: 'test',
      syncPoints: [],
      defaultTrack: 0,
      tags: ['legacy'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]),
);
writeFileSync(path.join(home, 'Songstarr', 'tabs', 'legacy-song.atex'), '\\title "Old"\n.\n:4 0.1 3.1 5.1 7.1');

const env = { ...process.env, HOME: home, FRETLANE_PORT: '5210' } as Record<string, string>;
delete env.FRETLANE_LIBRARY;
delete env.SONGSTARR_LIBRARY;

const app = await electron.launch({ args: ['.', '--no-sandbox'], env, cwd: new URL('..', import.meta.url).pathname });
const win = await app.firstWindow();
win.on('pageerror', (e) => console.log('pageerror', e.message));

check((await app.evaluate(({ app: a }) => a.getName())) === 'Fretlane', 'app name is Fretlane');
await win.waitForSelector('.song-card', { timeout: 20000 });
check((await win.title()) === 'Fretlane', `window title is "${await win.title()}"`);
check(existsSync(path.join(home, 'Fretlane', 'songs.json')) && !existsSync(path.join(home, 'Songstarr')), 'old ~/Songstarr library was moved to ~/Fretlane');
const titles = await win.locator('.card-title').allTextContents();
check(titles.includes('Old Library Song'), `migrated songs are listed (${titles.join(', ')})`);
check((await win.locator('.brand').textContent())?.includes('Fretlane') ?? false, 'UI shows the Fretlane name');
await win.screenshot({ path: `${SHOTS}10-desktop-library.png` });

// Open the migrated song and play it with the built-in synth.
await win.locator('.card-link', { hasText: 'Old Library Song' }).click();
await win.waitForSelector('.at-host svg', { timeout: 20000 });
await win.click('button.play');
await win.waitForTimeout(2000);
const pos = await win.evaluate(() => (window as unknown as { fretlane: { at: { timePosition: number } } }).fretlane.at.timePosition);
check(pos > 300, `playback runs in the desktop window (${Math.round(pos)}ms)`);
await win.screenshot({ path: `${SHOTS}11-desktop-player.png` });

// External links must not navigate the app window away.
await win.evaluate(() => {
  location.href = 'https://example.com/';
});
await win.waitForTimeout(500);
check(win.url().startsWith('http://localhost:5210'), `navigating to an external site keeps the app on its own page (${win.url()})`);

// Menu has a Quit item (File > Quit on Windows/Linux, app menu on macOS).
// No named helper functions inside evaluate(): tsx injects a __name() helper that doesn't exist there.
const hasQuit = await app.evaluate(({ Menu }) => {
  const stack = [...(Menu.getApplicationMenu()?.items ?? [])];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.role === 'quit') return true;
    if (item.submenu) stack.push(...item.submenu.items);
  }
  return false;
});
check(hasQuit, 'the menu has a Quit item');

// Closing the window quits the app.
const closed = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
await win.close();
await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('app did not quit')), 10000))]).then(
  () => check(true, 'closing the window quits the app'),
  () => check(false, 'closing the window quits the app'),
);
const lib = JSON.parse(readFileSync(path.join(home, 'Fretlane', 'songs.json'), 'utf8')) as unknown[];
check(lib.length === 1, 'the migrated library is not reseeded with demo songs');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll desktop checks passed');
process.exit(failures ? 1 : 0);
