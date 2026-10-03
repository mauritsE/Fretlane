# Fretlane

(Formerly "Songstarr". The app name lives in `shared/brand.ts`; the GitHub repo is `mauritsE/Fretlane`.)

A local-first, open-source Songsterr-style tab player. The browser app (vanilla TypeScript + Vite + alphaTab) talks to a small Node server that stores the library in `library/` as `songs.json` plus tab files.

## Architecture
- `server/app.ts`: `startServer()`, the shared HTTP server. `server/index.ts` is the npm entry (dev/`npm start`); `desktop/main.ts` is the desktop-app entry (Electron: runs the server in-process, shows the UI in a native window, library in `~/Fretlane`).
- `server/index.ts`: CLI entry for the `node:http` server bound to 127.0.0.1. Serves `/api/songs` (CRUD + `/:id/tab`) and `/api/fetch?url=` (tab download proxy), plus `dist/` when started with `--serve-dist`.
- `server/library.ts`: JSON "database" with atomic writes, format detection, and ASCII→alphaTex conversion on import. Seeds `demo/` on first run.
- `shared/`: pure, tested logic used by both sides (types, YouTube/Spotify link parsing, format detection, `mediaClock.ts`, `asciiTab.ts`, `sync.ts`).
- `shared/songbook.ts` + `shared/music.ts`: generate multi-track alphaTex from `songbook/songs.ts` (note names and chord symbols; fingering is computed). `npm run build-songbook` writes `demo/*.atex`; `tests/songbook.test.ts` checks bar lengths and that alphaTab plays the written pitches.
- `src/metronome.ts`: Web Audio metronome panel (timing maths in `shared/metronome.ts`).
- `src/playerView.ts`: alphaTab setup and the recording ↔ alphaTab bridge (external-media mode plus sync points). The recording is a `MediaPlayer` (`src/media.ts`): `src/youtube.ts` or `src/spotify.ts`. A song has a `youtubeId` or a `spotifyId`, never both, because sync pins belong to one recording. `src/libraryView.ts`: library grid and the add/edit dialog.

## Conventions
- TypeScript everywhere, strict mode, no framework. DOM is built with the `h()` helper in `src/dom.ts`.
- Keep maths and parsing in `shared/` so vitest can cover it. Keep browser-only code in `src/`.
- Do not bundle or fetch copyrighted tabs. Demo tabs must be original; songbook songs must be public-domain melodies (traditional, or composers who died long ago) in our own arrangements.

## Skills (in `.claude/skills/`)
- `fretlane-add-song`: importing songs and setting up sync pins.
- `fretlane-verify`: the verification routine (typecheck, vitest, Playwright e2e with fake YouTube and Spotify, production run) and environment gotchas.
- `fretlane-release`: building, verifying and publishing the desktop app (Electron) for non-technical users.
- `alphatab-integration`: alphaTab facts learned the hard way (Vite asset setup, external media API, sync points, alphaTex, the string-numbering quirk).

## Which model for which task
- **Haiku (Explore agent):** read-only lookups such as grepping `alphaTab.d.ts` for exact signatures or finding where something lives. Fast and cheap, and verbatim extraction is all it needs to do.
- **Sonnet:** well-specified implementation from a clear spec, e.g. writing a test suite for existing pure modules or adding a self-contained importer. Tell it to report source bugs rather than weaken assertions. That is how the `resolveTuning` crash and the sync-pin normalization gap were found.
- **Opus (main session):** architecture and cross-cutting integration (the YouTube/alphaTab clock bridge), debugging in the real browser, reviewing subagent output, and anything user-facing.
