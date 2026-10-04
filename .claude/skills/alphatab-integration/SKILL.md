---
name: alphatab-integration
description: Working knowledge for alphaTab (@coderline/alphatab 1.8.x) in a Vite + TypeScript app. Covers syncing to external media such as YouTube, sync points, asset/font setup, alphaTex syntax, the string-numbering quirk and validating tabs in Node. Use when changing tab rendering or playback, adding alphaTab features, writing alphaTex, or debugging "tab doesn't render / cursor out of sync".
---

# alphaTab integration notes (verified against 1.8.4)

## Look up the API, don't guess
The complete typed API is in `node_modules/@coderline/alphatab/dist/alphaTab.d.ts`. Grep it (for example `grep -n "interface IExternalMediaHandler" -A 30`). A cheap, fast subagent (Haiku) is good at pulling verbatim declarations out of it.

## Vite setup (both are required)
- Use the `@coderline/alphatab-vite` package (the `@coderline/alphatab/vite` entry is deprecated): `plugins: [alphaTab()]`. It copies `font/` and `soundfont/` into `public/` (gitignored) and wires up the worker and worklet.
- `optimizeDeps: { exclude: ['@coderline/alphatab'] }`, **and** set `core.fontDirectory: `${import.meta.env.BASE_URL}font/``. Otherwise dev mode tries to load the Bravura font from `node_modules/.vite/deps/font/`: you get "OTS parsing error", "Font not available", and nothing renders.
- `player.soundFont: `${BASE_URL}soundfont/sonivox.sf2``. Vite serves `.sf2` with a text/html content type, but the bytes are correct and it works.

## Syncing to YouTube (or any external media)
- `player.playerMode = PlayerMode.EnabledExternalMedia`.
- After the player exists (`at.player` or `at.playerReady`), set `(at.player.output as synth.IExternalMediaSynthOutput).handler = { backingTrackDuration (ms), playbackRate get/set, masterVolume get/set, seekTo(ms), play(), pause() }`. alphaTab then calls these when the user clicks play, seeks or loops in the tab.
- Push the media clock every animation frame: `output.updatePosition(videoSeconds * 1000)`.
- Mirror media state into alphaTab: YT PLAYING → `at.play()`, PAUSED → `at.pause()`, ENDED → `at.stop()`. Calling `at.play()` again calls `handler.play()`, which is harmless.
- **All times are milliseconds** on the alphaTab side, while YouTube uses seconds.
- Sources that only report their position now and then (Spotify's embed) need interpolation between reports (`shared/mediaClock.ts`), or the cursor stutters.
- alphaTab calls `handler.seekTo()` on its own, for example when the tab reaches its end. Don't build logic that assumes every seek came from the user.

## Sync points
- Model: `MasterBar.syncPoints: Automation[] | undefined`. The easy path is `score.applyFlatSyncPoints([{ barIndex, barPosition: 0, barOccurence: 0, millisecondOffset }])`, followed by `at.updateSyncPoints()` after any change.
- Clear old ones first (`mb.syncPoints = undefined` on every master bar), because apply adds to what is there.
- Apply in `at.scoreLoaded`, which fires before the MIDI and time map are built.
- With no sync points, media time 0 = tick 0.
- If the first pin isn't on bar 0, extrapolate a bar-0 point from the score tempo (`shared/sync.ts#toFlatSyncPoints`). Otherwise bars before the first pin map strangely.

## Loading
- alphaTex: `at.tex(text, [trackIndex])`. Binary GP or MusicXML: `at.load(uint8array, [trackIndex])`.
- Switch tracks with `at.renderTracks([track])`. After changing `at.settings.display.*`, call `at.updateSettings(); at.render()`.

## alphaTex cheat sheet (validated)
```
\title "Name" \artist "Who" \tempo 112
.
\track "Guitar"
\staff {tabs}
\tuning (e4 b3 g3 d3 a2 e2)
\instrument overdrivenguitar
:8 0.6 3.6 (0.6 2.5) r | :16 5.3 7.3 :4 7.4{h} (0.6 2.5 2.4)
\track "Drums"
\instrument percussion
\staff {score}
:8 (36 42) 42 (38 42) 42
```
- A note is `fret.string`, and string 1 is the **highest** string. `:8` sets the duration for the notes that follow, `r` is a rest, `(a b)` is a chord, `|` ends a bar. Effects: `{h}` hammer/pull, `{sl}` slide, `{v}` vibrato, `{b (0 4)}` bend, and `x.3` is a dead note.
- Percussion notes are GM numbers (36 kick, 38 snare, 42 closed hat, 49 crash).
- **Quirk:** in the parsed model `Note.string` is reversed (alphaTex string 1 → model string 6 on a 6-string). Compare `note.realValue` (MIDI pitch) instead of `.string` in tests.

## Validate without a browser
`npm run validate-tab -- file...` uses `AlphaTexImporter.initFromString(tex, new Settings()).readScore()` or `ScoreLoader.loadScoreFromBytes(bytes, settings)` in Node.
