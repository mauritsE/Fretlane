---
name: fretlane-release
description: Build, verify and publish Fretlane's desktop app (Electron + electron-builder) for Windows, macOS and Linux, aimed at non-technical users. Use when the user asks for a release, a new version, a download for someone else, an installer or app bundle, a rename of the app, or changes anything in desktop/, release/, build/ or server/app.ts.
---

# Releasing Fretlane

## How the app is put together
- `desktop/main.ts` is the Electron main process. It runs `startServer()` from `server/app.ts` in-process, serves `dist/` and seeds `demo/` from inside `app.asar`, and opens a `BrowserWindow` on `http://localhost:<port>`. It holds a single-instance lock, sets up a menu with Quit / Show Songs Folder / Help, sends external links to the browser, and quits when the window closes. esbuild bundles it into `desktop-dist/main.cjs` (`npm run build:desktop`).
- Library: `~/Fretlane`. An existing `~/Songstarr/songs.json` (the app's old name) is renamed to that folder on first launch. Env: `FRETLANE_LIBRARY`, `FRETLANE_PORT`, `FRETLANE_SMOKE` (prints `FRETLANE_READY <url>` once the window has loaded). `SONGSTARR_*` variables are still honoured through `envVar()` in `shared/brand.ts`.
- The name lives only in `shared/brand.ts` plus `productName` / `appId` in package.json's `build` section.
- Icon: `build/icon.svg` → `npm run render-icon` → `build/icon.png` (1024², used for every platform). `public/icon.svg` serves as the favicon and in-app logo.
- Packaging is electron-builder, configured in package.json `build`:
  - mac: `zip` target for arm64 + x64, with `identity: "-"` so the app is ad-hoc signed.
  - win: `nsis`, one-click, per-user install, desktop and Start menu shortcuts.
  - linux: `AppImage`.
  - `scripts/collect-licenses.mjs` puts MIT, alphaTab MPL-2.0, Bravura OFL and Sonivox licences into `resources/licenses`.

## Build + verify (all of it, before calling a release done)
1. `npm run typecheck && npm test`
2. Linux locally: `npm run dist:desktop -- --linux AppImage`.
3. `xvfb-run -a npx tsx e2e/desktop.ts` drives the real window with Playwright. It covers the app name and title, library migration, render and playback, external links staying out of the window, the Quit menu, and quit-on-close.
4. `APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a node release/smoke.mjs release/out/Fretlane-*.AppImage -- --no-sandbox` launches the built package.
5. macOS and Windows can only be verified in CI. Run the Release workflow on the branch with `publish: false` (`actions_run_trigger` → `run_workflow`, `release.yml`, ref = the branch) and wait until every job is green:
   - `macos`: `codesign --verify --deep --strict`, then launches the arm64 app natively and the x64 app via Rosetta.
   - `macos-intel`: native launch of the Intel app on `macos-15-intel`.
   - `windows`: launches the unpacked app, then does a silent NSIS install (`/S`), stops any auto-started copy, and launches the installed `Fretlane.exe`.
6. Look at `e2e/screenshots/1*-desktop-*.png`.

## Gotchas (learned the hard way)
- **Never ship a package that hasn't been launched on its own OS.** v0.1.0's Mac builds (Bun cross-compiled) had an invalid ad-hoc signature and would not start. A signature being *present* proves nothing: verify it with `codesign --verify --strict` on a Mac, or recompute the CodeDirectory page hashes.
- **Smoke-test isolation:** give each launch its own `FRETLANE_LIBRARY` and `FRETLANE_USER_DATA` temp folders. Never fake `HOME`/`USERPROFILE`: on Windows, Chromium then crashes at start with `0x80000003` and prints nothing. macOS ignores `HOME` for the profile folder and the single-instance lock, so a second launch hangs behind the first one's leftovers.
- Kill the whole process tree after a launch (`taskkill /T /F` on Windows, `kill -<pgid>` elsewhere). Leftover "Fretlane Helper" processes block the next launch.
- The x64 Mac app under Rosetta on an arm64 runner needs a long timeout (`--timeout 300`, plus `--disable-gpu` for that launch). The `macos-15-intel` runner launches it natively in about 3 s; that job is diagnostic (`continue-on-error`).
- Running as root, as in this sandbox, needs `--no-sandbox` for Electron. CI Linux needs `xvfb-run`, and AppImages need `APPIMAGE_EXTRACT_AND_RUN=1` because there is no FUSE.
- The Electron binary download can be cut off by the sandbox proxy ("assert(!this.paused)" from undici). Re-run `node node_modules/electron/install.js` until `node_modules/electron/path.txt` exists.
- Inside Playwright `electronApp.evaluate()`, don't define named helper functions: tsx injects `__name()`, which doesn't exist there.
- Unsigned apps show Gatekeeper ("can't verify") and SmartScreen warnings. `release/RELEASE_NOTES.md` explains the one-time bypass in plain words, so keep that text jargon-free. Removing the warnings needs a paid Apple Developer ID (plus notarisation) and a Windows signing certificate.
- Cloud sessions can't push tags (the push fails with "remote end hung up"). Publish through workflow_dispatch instead.

## Publishing
Publishing makes a public release, so only do it when the user asks.
1. Bump `version` in package.json through a normal PR, and merge it.
2. Run **Release** on `main` with `publish: true`, or push a `vX.Y.Z` tag.
3. Confirm the run is green and that the release has 4 assets: mac-arm64.zip, mac-x64.zip, windows-setup.exe and linux AppImage (`list_releases`, or `https://api.github.com/repos/<repo>/releases`).

## Mac App Store
- Config: `build.mas` in package.json (inherits `build.mac`, so `identity: "-"` must be overridden: CI passes `-c.mas.identity=null` for the unsigned sandbox check and `-c.mas.identity="$MAS_SIGNING_NAME"` for the store build). Entitlements: `build/entitlements.mas.plist` (sandbox, network server for the 127.0.0.1 library server, network client, user-selected files read-only) and `.inherit.plist`.
- In the sandbox `app.getPath('home')` is the container, so the library lands in `~/Library/Containers/app.fretlane/Data/Fretlane`; `process.mas` skips the legacy ~/Songstarr migration.
- `release/smoke.mjs --sandboxed` must not set FRETLANE_LIBRARY/USER_DATA (the sandbox blocks /tmp paths) and checks the library path is inside Containers.
- `release/mas-adhoc-sign.sh` ad-hoc signs the unsigned MAS app with the entitlements so CI can launch it without Apple certificates. Sign `Contents/Library/LoginItems/*.app` too (MAS builds have a login helper; it can't inherit, so it gets the app entitlements).
- **Sandboxed Chromium aborts at launch** (`bootstrap_check_in <id>.MachPortRendezvousServer: Permission denied (1100)`) unless its Mach service prefix is an application group. Without `ElectronTeamID` in Info.plist the prefix is the bundle id, so the ad-hoc check declares `app.fretlane` as a group. The signed store build gets `ElectronTeamID` + the `<TEAMID>.app.fretlane` group from @electron/osx-sign's preAutoEntitlements (source: node_modules/@electron/osx-sign/dist/cjs/util-entitlements.js). `-c.mas.extendInfo.X=...` on the CLI does not reach Info.plist.
- `appstore/LISTING.md` is the copy-paste sheet for every App Store Connect field; keep its claims true to the app and run `node appstore/check-lengths.mjs` after editing it. Screenshots: `scripts/appstore-screenshots.ts` against a running app with a fresh library.
- The Apple side (developer account, certificates, profile, API key, secrets) is the user's job; `appstore/SUBMITTING.md` is the checklist. Never claim the app is "on the App Store" before the user confirms review passed.
- The App Store build is paid (€4.99 one-time, set in App Store Connect, not in code). GitHub releases and the source stay free: never add license checks, paywalls or feature gates to the code.
