---
name: fretlane-verify
description: Verify a change to Fretlane end to end (typecheck, unit tests, browser e2e with a fake YouTube player, production build). Use after editing anything in src/, server/ or shared/, before committing, or when the user asks whether the app works.
---

# Verifying Fretlane changes

Run these in order and stop at the first failure:

1. `npm run typecheck`
2. `npm test` (vitest: shared/, the server library, and ASCII→alphaTex output parsed by the real alphaTab)
3. Start the app in the background: `npm run dev > <scratchpad>/dev.log 2>&1 &`, then give it a few seconds.
4. `npm run e2e` runs a Playwright smoke test against http://localhost:5173. It covers the library, synth playback, track switching, the ASCII import, the YouTube bridge, sync pins, speed and click-to-seek.
5. Production path: `npm run build`, then `FRETLANE_PORT=5180 FRETLANE_LIBRARY=<scratchpad>/lib npx tsx server/index.ts --serve-dist &` and `npm run e2e -- http://localhost:5180`.
6. Desktop app: `npm run build:desktop && xvfb-run -a npx tsx e2e/desktop.ts` drives the real Electron window.
7. Look at the screenshots in `e2e/screenshots/` with the Read tool. Passing asserts do not prove the UI looks right.

## Environment gotchas (learned the hard way)
- **YouTube is often blocked in sandboxes.** The e2e test routes `https://www.youtube.com/iframe_api` to a fake `window.YT` with a simulated clock (`window.__fakeYT`). This tests *our* bridge, not YouTube itself. Say so when reporting: real-video playback needs a manual check on a normal network.
- **Playwright browser mismatch:** if `playwright install` isn't possible, the test uses `/opt/pw-browsers/chromium` or `CHROMIUM_PATH`.
- `pkill -f serve-dist` also matches the shell running it (exit code 144). Kill by PID instead, or ignore that exit code.
- `window.fretlane` exposes `{ at, video, song }` in the player page for debugging (`at` is the AlphaTabApi).
- A hidden overlay needs `waitForSelector(sel, { state: 'attached' })`, not the default `visible`.

## Honest reporting
Report which checks ran and what they covered. Never claim YouTube playback was verified when only the fake player ran.
