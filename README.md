# Songstarr 🎸

An open-source, local-first tab player in the spirit of Songsterr. Load a tab from anywhere, link a YouTube video, and play along. The tab cursor follows the recording.

- **Tabs from anywhere:** Guitar Pro 3–8 (`.gp3/.gp4/.gp5/.gpx/.gp`), MusicXML (`.xml/.musicxml/.mxl`), [alphaTex](https://alphatab.net/docs/alphatex/introduction), and plain-text ASCII tabs. You can upload a file, give a URL (the local server downloads it, so there are no CORS problems), or paste text.
- **Plays along with YouTube:** the video is the clock. Play, pause, seek, speed and looping on either the tab or the video stay in sync.
- **Sync editor:** pin bars to moments in the video. One pin sets the start. More pins let the tab follow tempo drift in a live recording. You can also press **T** on every downbeat to tap the song in.
- **Library:** search, tags, per-song settings (last track, sync pins), all stored as plain files in `library/`.
- **Practice tools:** speed 25–150%, loop a selection (drag across the tab, then press **L**), track switching, Tab / Score+Tab / Score views, page or horizontal layout, zoom. Without a video you also get the built-in synthesizer with mute/solo, metronome and count-in.

Everything runs on your machine. Nothing is uploaded anywhere.

## Download (no programming needed)

Go to the [Releases page](https://github.com/mauritsE/Songstarr/releases), download the zip for your computer (Windows, Mac or Linux), unzip it, and double-click **Songstarr**. Your browser opens the app. The included **START HERE.txt** explains everything in plain language, including the one-time "unidentified developer" warning from Windows or macOS.

You don't need to install Node.js or anything else. Your songs are saved in a `Songstarr` folder in your home folder.

## Quick start (from source)

Requires Node.js 20+.

```bash
git clone https://github.com/mauritsE/Songstarr.git
cd Songstarr
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

**Where tabs come from:** use tabs you wrote yourself (Guitar Pro, TuxGuitar and MuseScore can all export compatible files), tabs you bought, or tabs whose license allows it. Songstarr does not ship or scrape anyone's tabs.

## Syncing a tab to a video

1. Open the song and click **⇆ Sync**.
2. Pause the video exactly on the first beat of bar 1, then click **📌 Pin to video time**. That is often all a studio recording needs.
3. If the band speeds up or slows down, pin more bars the same way. Or click **Tap along**, play the video, and press **T** on the first beat of each bar.
4. Use **Shift all** (±0.05 s / ±0.5 s) to nudge everything. Pins are saved automatically.

Under the hood the pins become alphaTab *sync points*, and alphaTab stretches the tab's timeline between them.

## Plain-text (ASCII) tabs

Most tabs on the web are text like `e|---0---3---|`. Songstarr converts them to alphaTex on import: it detects string names and tuning, bars, chords, two-digit frets, hammer-ons/pull-offs, slides, bends, vibrato and dead notes.

**Limitation:** text tabs have no real rhythm, so every note column becomes an eighth note. The notes and bars are right, but the timing inside a bar is approximate. Pin every bar (tap-along works well for this) to keep the cursor on the right bar.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `SONGSTARR_LIBRARY` | `./library` | Where `songs.json` and tab files are stored |
| `SONGSTARR_PORT` | `5174` (dev API) / `5173` (`npm start`) | Server port |
| `SONGSTARR_HOST` | `127.0.0.1` | Bind address. The server is meant to be local only |
| `SONGSTARR_URL` | `http://localhost:5173` | Used by `npm run add-song` |

Back up or sync your library by copying the `library/` folder.

## Development

```bash
npm run typecheck
npm test                 # unit + integration tests (vitest)
npm run e2e              # browser smoke test against a running dev server (Playwright, fake YouTube)
npm run validate-tab -- demo/*.atex some.gp5   # parse tabs with alphaTab in Node and print a summary
```

### Making a release

The release packages are standalone executables made with `bun build --compile`. Each one bundles the server, the built UI and the demo songs. Bun cross-compiles every platform from one machine.

```bash
npm run release                                   # needs Bun: https://bun.sh
npm run release -- --targets windows-x64,macos-arm64
```

This writes `release/out/Songstarr-<version>-<platform>.zip` for windows-x64, macos-arm64, macos-x64, linux-x64 and linux-arm64.

To publish, bump `version` in `package.json`, then either push a tag (`git tag v0.2.0 && git push origin v0.2.0`), or open **Actions → Release → Run workflow** on `main` with **publish** ticked. The workflow tests the code, builds all zips and publishes them as a GitHub Release, using `release/RELEASE_NOTES.md` as the description.

The executable (`release/launcher.ts`):
- stores the library in `~/Songstarr`
- uses port 5173, or the next free one if that's taken
- opens the browser, or reuses a copy that's already running
- honours the `SONGSTARR_LIBRARY`, `SONGSTARR_PORT` and `SONGSTARR_NO_BROWSER` environment variables

Project layout:

```
server/    Node HTTP server: library storage (JSON + files), tab download, static hosting
shared/    Pure TS used by both sides: types, YouTube URL parsing, format detection, ASCII→alphaTex, sync maths
src/       Browser app (vanilla TS + Vite): library view, player view, YouTube bridge
demo/      Original demo tabs seeded into a fresh library
tests/     vitest suites
e2e/       Playwright smoke test (replaces YouTube with a fake player so it runs offline)
scripts/   CLI helpers (add-song, validate-tab)
release/   Standalone executable launcher, package builder, START HERE text, release notes
.claude/   Claude Code skills learned while building this (see below)
```

Rendering and playback are done by [alphaTab](https://alphatab.net) (MPL-2.0). Music font: Bravura (OFL). Soundfont: Sonivox (Apache-2.0).

### Working on it with Claude Code

`.claude/skills/` holds project skills with the repeatable know-how: adding and syncing songs, verifying changes, and the alphaTab integration details. `CLAUDE.md` describes the architecture and which model to use for which kind of task.

## Support Songstarr

Songstarr is free and open source. If it helps you learn songs and you'd like to say thanks, use the **Sponsor** button at the top of the [GitHub page](https://github.com/mauritsE/Songstarr). Bug reports and ideas are just as welcome.

## License

MIT, see [LICENSE](LICENSE).
