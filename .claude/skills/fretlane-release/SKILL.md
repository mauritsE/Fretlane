---
name: fretlane-release
description: Build, verify and publish Fretlane's double-click release packages (standalone executables for Windows, macOS and Linux, made with bun build --compile) for non-technical users. Use when the user asks for a release, a new version, a download for someone else, or changes anything in release/ or server/app.ts.
---

# Releasing Fretlane

## How the package works
- `release/build.ts` runs `npm run build`, then generates `release/generated/entry.ts` (gitignored), which embeds `dist/` (minus unused font formats and licence texts) and `demo/` as base64 and calls `runLauncher()` from `release/launcher.ts`.
- `bun build --compile --target=bun-<os>-<arch>` cross-compiles every target from Linux. Targets: windows-x64, macos-arm64, macos-x64, linux-x64, linux-arm64.
- Each zip contains the executable, `START HERE.txt` (from `release/startHere.ts`, CRLF line endings on Windows) and `licenses/`: MIT, alphaTab MPL-2.0, Bravura OFL, Sonivox.
- The zip is made with Info-ZIP `zip -qry`, which keeps the executable bit, so Mac and Linux users can double-click right after unzipping.

## Build + verify (do all of it before calling a release done)
1. `npm run typecheck && npm test`
2. `npm run release`, or `-- --targets linux-x64` for a quick loop.
3. Check the file headers: ELF `7f 45 4c 46`, Mach-O `cf fa ed fe`, PE `4d 5a`.
4. Behave like a user. Unzip into the scratchpad, then run `HOME=<tmp>/home FRETLANE_NO_BROWSER=1 nohup ./Fretlane &`. Check the friendly output and that `~/Fretlane` got seeded.
5. `npm run e2e -- http://localhost:5173` against the running binary.
6. Launch it a second time: it must print "already running" and exit 0. Put a different program on the port (`python3 -m http.server <port>`): it must move to port+1.
7. Stop processes with `pkill -x Fretlane`. A `pkill -f <pattern>` whose pattern appears in your own command line kills your own shell (exit 144). Use `pkill -f "http.server 519[0]"`-style patterns.

Only the Linux binary can actually run in the sandbox. Windows and macOS runs cannot be verified here, so say so and ask the user to try them.

## Gotchas
- **Bun's cross-compiled macOS binaries have an INVALID ad-hoc signature.** Checking that `LC_CODE_SIGNATURE` exists is not enough. v0.1.0 shipped like that and would not run on Macs: the arm64 build had 1 page whose hash mismatched, and the x64 build's codeLimit stopped short of the embedded payload. Recompute the CodeDirectory page hashes to check this on Linux. The fix is `codesign --remove-signature` followed by `codesign --force --sign -` on a Mac: the Release workflow's `macos` job does this, and so does `build.ts` when it runs on macOS.
- x64 targets use Bun's `*-baseline` runtimes, which don't need AVX2, so they work on older CPUs. Under Rosetta, even the baseline runtime prints "warn: CPU lacks AVX support". The check is simply built into both runtimes, and it is harmless for baseline, so ignore it. Real Intel Macs have AVX.
- The Release workflow launches every package on its own OS before publishing: `node release/smoke.mjs <exe>` for Linux, macOS arm64, macOS x64 (via Rosetta) and Windows. A package that has never actually started on its target OS must not be published.
- `--windows-title` and other Windows metadata flags only work when compiling on Windows. `build.ts` skips them elsewhere.
- Bun's `.exe` gets flagged by SmartScreen, and Mac builds hit Gatekeeper ("developer cannot be verified"), because they are unsigned. START HERE explains the one-time bypass in plain words. Real code signing would need paid Apple and Microsoft certificates.
- Keep all user-facing text jargon-free: no "terminal", "port" or "server" in START HERE, except the localhost URL as a fallback.

## Publishing
Publishing makes a public release, so only do it when the user asks.
1. Bump `version` in package.json through a normal PR, and merge it.
2. Publish, either way:
   - Tag push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
   - Actions: run the **Release** workflow on `main` with `publish: true`. With the GitHub MCP tools, that is `actions_run_trigger` (`run_workflow`, `release.yml`, ref `main`, inputs `{publish: true}`). The workflow creates tag `v<version>` on that commit plus the Release, with `release/RELEASE_NOTES.md` as the text.
3. Watch the run (`actions_list list_workflow_runs`), then confirm with `list_releases` that the release exists and has 5 zip assets.

**Learned:** cloud sessions can often only push their own working branch. `git push origin <tag>` fails with "remote end hung up / unexpected disconnect" while the proxy status shows no relay failure. Don't retry or route around it. Use the workflow_dispatch route instead, since it is the project's normal release mechanism.
