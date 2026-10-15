---
name: fretlane-verify
description: Verify a change to Fretlane end to end (typecheck, unit tests, browser e2e with fake YouTube and Spotify players, production build). Use after editing anything in src/, server/ or shared/, before committing, or when the user asks whether the app works.
---

# Verifying Fretlane changes

Run these in order and stop at the first failure:

1. `npm run typecheck`
2. `npm test` (vitest: shared/, the server library, and ASCII→alphaTex output parsed by the real alphaTab)
3. Start the app in the background: `npm run dev > <scratchpad>/dev.log 2>&1 &`, then give it a few seconds.
4. `npm run e2e` runs a Playwright smoke test against http://localhost:5173. It covers the library, synth playback, track switching, the ASCII import, the YouTube, Spotify and audio-file bridges, sync pins, speed and click-to-seek.
5. Production path: `npm run build`, then `FRETLANE_PORT=5180 FRETLANE_LIBRARY=<scratchpad>/lib npx tsx server/index.ts --serve-dist &` and `npm run e2e -- http://localhost:5180`.
6. Fretlane Cloud: `npm run e2e:cloud` (needs `npm run build`) runs its own server against a fake website + fake Supabase and drives sign-in, the cloud list, import and sign-out. The real site and Supabase are not reachable from sandboxes; say so when reporting.
6b. Tab editor: `npm run e2e:editor` (needs `npm run build`) runs against a fake website + fake Supabase with a subscription row: the Premium upsell and unlock, typing with the keyboard, the caret position against alphaTab's note-head bounds, undo, bars, autosave, playback, tracks, `.gp` export, "Make my version", and the API refusing writes once the plan ends. It prints re-render times on a 200-bar song. `DEBUG_ERRORS=1` shows after which step page errors appeared.
7. Desktop app: `npm run build:desktop && xvfb-run -a npx tsx e2e/desktop.ts` drives the real Electron window.
8. Look at the screenshots in `e2e/screenshots/` with the Read tool. Passing asserts do not prove the UI looks right.

## Environment gotchas (learned the hard way)
- **YouTube is often blocked in sandboxes.** The e2e test routes `https://www.youtube.com/iframe_api` to a fake `window.YT` with a simulated clock (`window.__fakeYT`). This tests *our* bridge, not YouTube itself. Say so when reporting: real-video playback needs a manual check on a normal network.
- **Spotify is blocked too.** `https://open.spotify.com/embed/iframe-api/v1` is routed to a fake controller (`window.__fakeSP`) that copies the real embed's quirks as far as we know them: position reports only every 500 ms, `play()` restarts from the top, and a seek before the first play is ignored. The real embed's report rate and seek behaviour have not been measured; check them on a normal network.
- **Audio files are tested for real:** the e2e test generates a WAV click track and plays it in Chromium's real `<audio>` element (headless Chromium plays to a fake sink, so `currentTime` advances). MP3/AAC decoding is not covered there; Electron ships those codecs.
- **Playwright browser mismatch:** if `playwright install` isn't possible, the test uses `/opt/pw-browsers/chromium` or `CHROMIUM_PATH`.
- `pkill -f serve-dist` also matches the shell running it (exit code 144). Kill by PID instead, or ignore that exit code.
- `window.fretlane` exposes `{ at, video, song }` in the player page for debugging (`at` is the AlphaTabApi).
- A hidden overlay needs `waitForSelector(sel, { state: 'attached' })`, not the default `visible`.

## Honest reporting
Report which checks ran and what they covered. Never claim YouTube or Spotify playback was verified when only the fake players ran.
