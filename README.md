# Fretlane 🎸

An open-source, local-first tab player in the spirit of Songsterr. Load a tab from anywhere, link a YouTube video, and play along. The tab cursor follows the recording.

- **Tabs from anywhere:** Guitar Pro 3–8 (`.gp3/.gp4/.gp5/.gpx/.gp`), MusicXML (`.xml/.musicxml/.mxl`), [alphaTex](https://alphatab.net/docs/alphatex/introduction), and plain-text ASCII tabs. You can upload a file, give a URL (the local server downloads it, so there are no CORS problems), or paste text.
- **Plays along with YouTube:** the video is the clock. Play, pause, seek, speed and looping on either the tab or the video stay in sync.
- **Sync editor:** pin bars to moments in the video. One pin sets the start. More pins let the tab follow tempo drift in a live recording. You can also press **T** on every downbeat to tap the song in.
- **Library:** search, tags, per-song settings (last track, sync pins), all stored as plain files in `library/`.
- **Practice tools:** speed 25–150%, loop a selection (drag across the tab, then press **L**), track switching, Tab / Score+Tab / Score views, page or horizontal layout, zoom. Without a video you also get the built-in synthesizer with mute/solo, metronome and count-in.

Everything runs on your machine. Nothing is uploaded anywhere.

## Download (no programming needed)

Go to the [Releases page](https://github.com/mauritsE/Songstarr/releases) and download Fretlane for your computer:

- **Windows:** `Fretlane-…-windows-setup.exe`. Double-click it and it installs and opens, with Start menu and desktop shortcuts.
- **Mac:** `Fretlane-…-mac-arm64.zip` (Apple chip) or `…-mac-x64.zip` (Intel). Unzip it and drag **Fretlane** to Applications.
- **Linux:** `Fretlane-…-linux-x86_64.AppImage`. Make it executable and double-click it.

Fretlane is a normal desktop app, with its own window, icon and Quit menu. You don't need Node.js or anything else. The first time you open it, macOS or Windows asks whether you trust the app, because it isn't registered with Apple or Microsoft. The release page explains the one-time "Open Anyway" / "Run anyway" step.

Your songs are saved in a `Fretlane` folder in your home folder (**File → Show Songs Folder**). An existing `Songstarr` library (the app's old name) is moved over automatically.

## Quick start (from source)

Requires Node.js 20+.

```bash
git clone https://github.com/mauritsE/Songstarr.git
cd Fretlane
npm install
npm run dev        # UI on http://localhost:5173 (API on :5174, proxied)
```

Or build once and run a single process:

```bash
npm start          # builds, then serves app + API on http://localhost:5173
```

On first start the library is seeded with three small **original** demo tabs, so you can try the player right away.

## Adding songs

**In the app:** click **+ Add song**, choose *Upload file*, *From URL* or *Paste text*, and optionally paste a YouTube link.

**From the command line** (while the app is running):

```bash
npm run add-song -- ~/Tabs/my-song.gp5 --youtube https://youtu.be/XXXXXXXXXXX --tags rock,practice
npm run add-song -- https://example.com/some-tab.gp --title "Song" --artist "Band"
```

**Where tabs come from:** use tabs you wrote yourself (Guitar Pro, TuxGuitar and MuseScore can all export compatible files), tabs you bought, or tabs whose license allows it. Fretlane does not ship or scrape anyone's tabs.

## Syncing a tab to a video

1. Open the song and click **⇆ Sync**.
2. Pause the video exactly on the first beat of bar 1, then click **📌 Pin to video time**. That is often all a studio recording needs.
3. If the band speeds up or slows down, pin more bars the same way. Or click **Tap along**, play the video, and press **T** on the first beat of each bar.
4. Use **Shift all** (±0.05 s / ±0.5 s) to nudge everything. Pins are saved automatically.

Under the hood the pins become alphaTab *sync points*, and alphaTab stretches the tab's timeline between them.

## Plain-text (ASCII) tabs

Most tabs on the web are text like `e|---0---3---|`. Fretlane converts them to alphaTex on import: it detects string names and tuning, bars, chords, two-digit frets, hammer-ons/pull-offs, slides, bends, vibrato and dead notes.

**Limitation:** text tabs have no real rhythm, so every note column becomes an eighth note. The notes and bars are right, but the timing inside a bar is approximate. Pin every bar (tap-along works well for this) to keep the cursor on the right bar.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `FRETLANE_LIBRARY` | `./library` | Where `songs.json` and tab files are stored |
| `FRETLANE_PORT` | `5174` (dev API) / `5173` (`npm start`) | Server port |
| `FRETLANE_HOST` | `127.0.0.1` | Bind address. The server is meant to be local only |
| `FRETLANE_URL` | `http://localhost:5173` | Used by `npm run add-song` |

Back up or sync your library by copying the `library/` folder.

## Development

```bash
npm run typecheck
npm test                 # unit + integration tests (vitest)
npm run e2e              # browser smoke test against a running dev server (Playwright, fake YouTube)
npm run validate-tab -- demo/*.atex some.gp5   # parse tabs with alphaTab in Node and print a summary
```

### Desktop app and releases

The desktop app is [Electron](https://www.electronjs.org/). `desktop/main.ts` runs the same library server in-process and shows the UI in a native window. It keeps a single running instance, puts the library in `~/Fretlane`, uses port 5173 or the next free one, and opens external links in the browser.

```bash
npm run desktop                           # build and run the desktop app locally
npm run dist:desktop -- --linux AppImage  # package for the current OS (--mac / --win on those systems)
```

Packages land in `release/out/`:
- a macOS zip holding an ad-hoc signed `Fretlane.app` (Apple chip and Intel)
- a Windows one-click installer
- a Linux AppImage

To publish, bump `version` in `package.json`. Then either push a tag (`git tag v0.2.0 && git push origin v0.2.0`), or open **Actions → Release → Run workflow** on `main` with **publish** ticked. The workflow builds on real Linux, macOS and Windows machines and launches every build (on Windows, through a silent install). It publishes the GitHub Release only if they all start, using `release/RELEASE_NOTES.md` as the text.

To rename the app, change `shared/brand.ts` and `productName` / `appId` in `package.json`.

Project layout:

```
server/    Node HTTP server: library storage (JSON + files), tab download, static hosting
shared/    Pure TS used by both sides: types, YouTube URL parsing, format detection, ASCII→alphaTex, sync maths
src/       Browser app (vanilla TS + Vite): library view, player view, YouTube bridge
demo/      Original demo tabs seeded into a fresh library
tests/     vitest suites
e2e/       Playwright smoke test (replaces YouTube with a fake player so it runs offline)
scripts/   CLI helpers (add-song, validate-tab)
desktop/   Electron main process (the desktop app)
build/     App icon (icon.svg → icon.png via npm run render-icon)
release/   Release notes and the launch smoke test used in CI
.claude/   Claude Code skills learned while building this (see below)
```

Rendering and playback are done by [alphaTab](https://alphatab.net) (MPL-2.0). Music font: Bravura (OFL). Soundfont: Sonivox (Apache-2.0).

### Working on it with Claude Code

`.claude/skills/` holds project skills with the repeatable know-how: adding and syncing songs, verifying changes, and the alphaTab integration details. `CLAUDE.md` describes the architecture and which model to use for which kind of task.

## Support Songstarr

Songstarr is free and open source. If it helps you learn songs and you'd like to say thanks, you can [buy me a coffee on Ko-fi](https://ko-fi.com/mauritselzinga). Bug reports and ideas are just as welcome.

## License

MIT, see [LICENSE](LICENSE).
