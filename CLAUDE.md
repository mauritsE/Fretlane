# Songstarr

A local-first, open-source Songsterr-style tab player. The browser app (vanilla TypeScript + Vite + alphaTab) talks to a small Node server that stores the library in `library/` as `songs.json` plus tab files.

## Architecture
- `server/index.ts`: `node:http` server bound to 127.0.0.1. Serves `/api/songs` (CRUD + `/:id/tab`) and `/api/fetch?url=` (tab download proxy), plus `dist/` when started with `--serve-dist`.
- `server/library.ts`: JSON "database" with atomic writes, format detection, and ASCII→alphaTex conversion on import. Seeds `demo/` on first run.
- `shared/`: pure, tested logic used by both sides (types, YouTube id parsing, format detection, `asciiTab.ts`, `sync.ts`).
- `src/playerView.ts`: alphaTab setup and the YouTube ↔ alphaTab bridge (external-media mode plus sync points). `src/libraryView.ts`: library grid and the add/edit dialog.

## Conventions
- TypeScript everywhere, strict mode, no framework. DOM is built with the `h()` helper in `src/dom.ts`.
- Keep maths and parsing in `shared/` so vitest can cover it. Keep browser-only code in `src/`.
- Do not bundle or fetch copyrighted tabs. Demo tabs must be original.

## Skills (in `.claude/skills/`)
- `songstarr-add-song`: importing songs and setting up sync pins.
- `songstarr-verify`: the verification routine (typecheck, vitest, Playwright e2e with fake YouTube, production run) and environment gotchas.
- `alphatab-integration`: alphaTab facts learned the hard way (Vite asset setup, external media API, sync points, alphaTex, the string-numbering quirk).

## Which model for which task
- **Haiku (Explore agent):** read-only lookups such as grepping `alphaTab.d.ts` for exact signatures or finding where something lives. Fast and cheap, and verbatim extraction is all it needs to do.
- **Sonnet:** well-specified implementation from a clear spec, e.g. writing a test suite for existing pure modules or adding a self-contained importer. Tell it to report source bugs rather than weaken assertions. That is how the `resolveTuning` crash and the sync-pin normalization gap were found.
- **Opus (main session):** architecture and cross-cutting integration (the YouTube/alphaTab clock bridge), debugging in the real browser, reviewing subagent output, and anything user-facing.
