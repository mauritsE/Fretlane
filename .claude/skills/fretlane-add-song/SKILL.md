---
name: fretlane-add-song
description: Add songs to the Fretlane library (tab file, tab URL or pasted ASCII tab, plus optional YouTube video) and set up tab-to-video sync pins. Use when the user wants to import/add a song or tab, link a YouTube video to a song, fix a song whose cursor is out of sync, or bulk-import a folder of tabs.
---

# Adding songs to Fretlane

The app must be running (`npm run dev` or `npm start`); both expose the API at `http://localhost:5173/api`.

## Pick the route
- **One file or URL:** `npm run add-song -- <file|url> [--title T] [--artist A] [--youtube URL] [--tags a,b]`
- **Bulk folder:** loop over files with the same command, e.g.
  `for f in ~/Tabs/*.gp*; do npm run add-song -- "$f" --tags imported; done`
- **Pasted text or alphaTex:** `POST /api/songs` with `{"tabText": "...", "title": "...", "artist": "...", "youtube": "..."}`
- **Edit metadata or video later:** `PATCH /api/songs/:id` with any of `title, artist, youtube, tags, defaultTrack, syncPoints`

Supported tabs: Guitar Pro 3-8, MusicXML/.mxl, alphaTex, plain-text ASCII tabs. Format is detected from the extension first, then from content (`shared/util.ts#detectTabFormat`). ASCII tabs are converted to alphaTex **on import**, so the stored file is always playable.

If a URL returns an HTML page, the server extracts `<pre>` blocks and tries them as an ASCII tab. If that fails, ask the user for a direct file link.

## Copyright rule
Never fetch, reproduce or bundle copyrighted tabs yourself. Import only what the user supplies (their file or URL). Demo content in `demo/` must be original compositions.

## Sync pins
`syncPoints: [{ bar, time }]`, where `bar` is 0-based and `time` is seconds in the video.
- One pin on bar 0 = the video time of the first downbeat. That is often enough for studio recordings.
- Add pins where the recording drifts (live takes, rubato, tempo changes). alphaTab stretches time between pins.
- Pins are normalized server-side: one pin per bar, times must increase, invalid pins are dropped (`shared/sync.ts#normalizeSyncPoints`).
- ASCII-imported tabs have approximate rhythm (every column = 8th note), so pin **every bar**. The in-app "Tap along" (press T on each downbeat) is the fast way to do that.

## Checking the result
- `npm run validate-tab -- <file>` parses a tab with alphaTab in Node and prints title, bars, tempo and tracks.
- Open `http://localhost:5173/#/song/<id>`.
