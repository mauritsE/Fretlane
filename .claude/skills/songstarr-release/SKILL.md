---
name: songstarr-release
description: Build, verify and publish Songstarr's double-click release packages (standalone executables for Windows, macOS and Linux, made with bun build --compile) for non-technical users. Use when the user asks for a release, a new version, a download for someone else, or changes anything in release/ or server/app.ts.
---

# Releasing Songstarr

## How the package works
- `release/build.ts` runs `npm run build`, then generates `release/generated/entry.ts` (gitignored), which embeds `dist/` (minus unused font formats and licence texts) and `demo/` as base64 and calls `runLauncher()` from `release/launcher.ts`.
- `bun build --compile --target=bun-<os>-<arch>` cross-compiles every target from Linux. Targets: windows-x64, macos-arm64, macos-x64, linux-x64, linux-arm64.
- Each zip contains the executable, `START HERE.txt` (from `release/startHere.ts`, CRLF line endings on Windows) and `licenses/`: MIT, alphaTab MPL-2.0, Bravura OFL, Sonivox.
- The zip is made with Info-ZIP `zip -qry`, which keeps the executable bit, so Mac and Linux users can double-click right after unzipping.

## Build + verify (do all of it before calling a release done)
1. `npm run typecheck && npm test`
2. `npm run release`, or `-- --targets linux-x64` for a quick loop.
3. Check the file headers: ELF `7f 45 4c 46`, Mach-O `cf fa ed fe`, PE `4d 5a`. Mac binaries must contain `LC_CODE_SIGNATURE` (0x1d). Bun ad-hoc signs them, and without a signature Apple Silicon kills the app on launch.
4. Behave like a user. Unzip into the scratchpad, then run `HOME=<tmp>/home SONGSTARR_NO_BROWSER=1 nohup ./Songstarr &`. Check the friendly output and that `~/Songstarr` got seeded.
5. `npm run e2e -- http://localhost:5173` against the running binary.
6. Launch it a second time: it must print "already running" and exit 0. Put a different program on the port (`python3 -m http.server <port>`): it must move to port+1.
7. Stop processes with `pkill -x Songstarr`. A `pkill -f <pattern>` whose pattern appears in your own command line kills your own shell (exit 144). Use `pkill -f "http.server 519[0]"`-style patterns.

Only the Linux binary can actually run in the sandbox. Windows and macOS runs cannot be verified here, so say so and ask the user to try them.

## Gotchas
- `--windows-title` and other Windows metadata flags only work when compiling on Windows. `build.ts` skips them elsewhere.
- Bun's `.exe` gets flagged by SmartScreen, and Mac builds hit Gatekeeper ("developer cannot be verified"), because they are unsigned. START HERE explains the one-time bypass in plain words. Real code signing would need paid Apple and Microsoft certificates.
- Keep all user-facing text jargon-free: no "terminal", "port" or "server" in START HERE, except the localhost URL as a fallback.

## Publishing
Bump `version` in package.json, commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`. `.github/workflows/release.yml` builds and attaches the zips with `release/RELEASE_NOTES.md` as the description. Pushing a tag publishes a public release, so confirm with the user first. A manual `workflow_dispatch` run only uploads artifacts.
