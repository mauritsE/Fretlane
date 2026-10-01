/**
 * Desktop app entry (Electron main process). Runs the local library server in-process and shows
 * the UI in a native window, so users get a normal app: an icon, a Dock/taskbar entry and a Quit
 * menu, with no terminal and no browser tab.
 *
 * Bundled to desktop-dist/main.cjs by `npm run build:desktop` (esbuild).
 */
import { app, BrowserWindow, Menu, dialog, shell, type MenuItemConstructorOptions } from 'electron';
import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { dirAssets, startServer, type RunningServer } from '../server/app.ts';
import { APP_NAME, LEGACY_NAME, envVar } from '../shared/brand.ts';

const FIRST_PORT = Number(envVar('PORT') ?? 5173);
const PORT_ATTEMPTS = 20;
const REPO_URL = 'https://github.com/mauritsE/Songstarr';
/** Smoke tests set this: print the server URL once the UI has loaded. */
const SMOKE = !!envVar('SMOKE');

app.setName(APP_NAME);
// Tests run each launch with its own profile folder (single-instance lock, caches). On macOS and
// Windows the default profile folder ignores $HOME, so this is the only way to isolate runs.
const userDataOverride = envVar('USER_DATA');
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride));
// Let the Play button start YouTube playback without an extra click inside the video.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win: BrowserWindow | null = null;
let server: RunningServer | null = null;

/** ~/Fretlane, moving an existing ~/Songstarr library over on first run after the rename. */
function libraryDir(): string {
  const fromEnv = envVar('LIBRARY');
  if (fromEnv) return path.resolve(fromEnv);
  const home = app.getPath('home');
  const dir = path.join(home, APP_NAME);
  // Mac App Store build: "home" is the app's sandbox container, and there is no old library to find.
  if (process.mas) return dir;
  const legacy = path.join(home, LEGACY_NAME);
  if (!existsSync(dir) && existsSync(path.join(legacy, 'songs.json'))) {
    try {
      renameSync(legacy, dir);
    } catch {
      return legacy; // e.g. on another volume or locked: keep using the old folder
    }
  }
  return dir;
}

/** dist/ and demo/ sit next to desktop-dist/ inside the packaged app (app.asar). */
function appFile(...parts: string[]): string {
  return path.join(app.getAppPath(), ...parts);
}

async function startLibraryServer(): Promise<RunningServer> {
  const opts = { host: '127.0.0.1', libraryDir: libraryDir(), assets: dirAssets(appFile('dist')), seed: appFile('demo') };
  // A fixed port keeps the page's origin stable between runs; fall back to the next ones if taken.
  for (let port = FIRST_PORT; port < FIRST_PORT + PORT_ATTEMPTS; port++) {
    try {
      return await startServer({ ...opts, port });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    }
  }
  return startServer({ ...opts, port: 0 }); // any free port
}

function createWindow(url: string): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    title: APP_NAME,
    backgroundColor: '#16181d',
    icon: appFile('build', 'icon.png'),
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.once('did-finish-load', () => {
    if (SMOKE) console.log(`${APP_NAME.toUpperCase()}_READY ${url}`);
  });

  // Links that leave the app (e.g. "Watch on YouTube") open in the normal browser.
  const isInternal = (target: string) => target.startsWith(url);
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!isInternal(target)) {
      event.preventDefault();
      if (/^https?:/.test(target)) void shell.openExternal(target);
    }
  });
  win.on('closed', () => (win = null));
  void win.loadURL(url);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const library = () => server && void shell.openPath(libraryDir());
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Show Songs Folder', click: library },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: `Quit ${APP_NAME}` },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: `${APP_NAME} Website`, click: () => void shell.openExternal(REPO_URL) },
        { label: 'Report a Problem', click: () => void shell.openExternal(`${REPO_URL}/issues`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One running copy only: opening the app again just brings the window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      server = await startLibraryServer();
    } catch (err) {
      dialog.showErrorBox(`${APP_NAME} could not start`, (err as Error).message);
      app.quit();
      return;
    }
    createWindow(server.url);
    // macOS: clicking the Dock icon with no window open reopens it.
    app.on('activate', () => {
      if (!win && server) createWindow(server.url);
    });
  });

  // Closing the window quits the app on every platform, so nothing keeps running unseen.
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => void server?.close());
}
