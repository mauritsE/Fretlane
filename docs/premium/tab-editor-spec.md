# Fretlane Premium: the tab editor

Status: approved; v1 (M0–M5) implemented · Owner: Maurits · Last updated: 2026-10-15

> **Where the build differs from this plan** (details in [Implementation notes](#implementation-notes-v1)):
> written songs are stored as alphaTex rather than `.gp` (`.gp` is the export); the editor keeps
> its own document model instead of mutating alphaTab's; typed notes sound through a small
> built-in voice rather than alphaTab's `playNote()`; no website changes were needed for the plan
> check; and the Mac App Store build includes the editor without a plan.

## Summary

Fretlane Premium adds songwriting to Fretlane: a keyboard-first tab editor for writing your
own songs, in the same app you already use to practise. Signing in to a paid Fretlane Cloud
account unlocks it. Songs you write are normal library songs, so playback, the metronome,
looping and speed control work on them from day one.

## Problem

People who write songs with a guitar in their hands want to get a riff out of their fingers
and into something that plays back, then build a song around it. Today that means a
separate desktop editor (Guitar Pro, TuxGuitar, MuseScore). It's a different app with its
own library, and when you're done the song has to be exported and imported again before you
can practise it.

Fretlane already renders, plays and loops tabs and keeps a library of them. What it can't do
is create or change one.

## Who it's for

- **Primary:** a guitarist or bassist who writes their own material and thinks in tab, not
  standard notation. They have written in Guitar Pro or on paper before. They want speed of
  entry over engraving quality.
- **Secondary:** a Fretlane user who wants to fix a wrong note in an imported tab, or write
  down a part that has no tab anywhere.

Not for: composers writing for orchestra or piano, or anyone who needs print-quality scores.

## Why this is feasible now (verified against alphaTab 1.8.4)

alphaTab renders and plays scores and does not ship an editor, but it has the building blocks
for one. Each item below was checked in `node_modules/@coderline/alphatab/dist/alphaTab.d.ts`:

| Need | alphaTab 1.8.4 API |
| --- | --- |
| Click a note or beat to put the cursor there | `api.beatMouseDown`, `api.noteMouseDown` (with `settings.core.includeNoteBounds = true`), `BoundsLookup.getBeatAtPos(x, y)` and `getNoteAtPos(beat, x, y)` |
| Change the score | The model is plain mutable classes: `Beat.addNote()` / `removeNote()`, `Note.fret`, `Note.string`, `Beat.duration`, followed by `Score.finish(settings)` |
| Re-render after an edit without redrawing everything | `api.renderScore(score, tracks, { reuseViewport, firstChangedMasterBar })` (`RenderHints`) |
| Save | `Gp7Exporter.export(score)` gives a `.gp` file; `AlphaTexExporter.exportToString(score)` gives alphaTex text |

What we build ourselves: the cursor, the keyboard model, edit commands, undo/redo, bar
validation and the save path. M0 measured the re-render cost; see
[Implementation notes](#implementation-notes-v1).

## Principles

1. **Keyboard first.** Typing a fret number is the main input. The mouse places the cursor.
   Muscle memory from Guitar Pro should mostly carry over.
2. **Hear it immediately.** Entering a note plays it. Space plays from the cursor.
3. **Open files.** Songs save as `.gp` (Guitar Pro 7+ format), which Guitar Pro, TuxGuitar
   and MuseScore can open. No lock-in.
4. **Local-first stays true.** Writing works offline. The cloud adds backup and sync; your
   songs live on your computer.

## Scope

### MVP (v1)

**Create**
- New song: title, tempo, time signature, and one or more tracks (guitar 6-string, bass 4-string)
  with a tuning picker (standard, drop D, half-step down, plus custom).
- Starts with 4 empty bars of rests.

**Enter and edit notes** (on the tab staff)
- Cursor on a beat and string. Arrow keys move it: left/right by beat, up/down by string.
  Clicking a note moves the cursor there.
- Digits enter a fret; two digits typed quickly enter 10 to 24.
- Durations: whole to 1/32 by key, plus dotted and triplet. Rests.
- Chords: several strings on the same beat.
- Delete note, delete beat, insert beat.
- Bars: insert, delete, copy and paste a range of bars, repeat signs.
- A bar-fullness indicator: a bar that's too short or too long is marked, the way
  `tests/songbook.test.ts` checks bar lengths today.
- Undo and redo for every edit.

**Hear it**
- Entering a note plays that note.
- Space plays from the cursor. The loop, speed and metronome from the player work in the
  editor too.

**Save**
- Saves into the library as a normal song, autosaved after each edit (debounced), so it shows
  in the library grid like any other song. *Built:* stored as alphaTex (`tabFormat: 'alphatex'`,
  `written: true`), not `.gp`; see the notes.
- Export `.gp` to disk.

**Unlock**
- The editor is visible to everyone. Using it needs a signed-in Fretlane Cloud account with
  an active Premium plan (see [Paywall](#paywall-and-entitlement)).

### Next (v1.1 to v2, in rough order)

- Techniques: hammer-on/pull-off, slide, bend, vibrato, palm mute, let ring, dead note.
- Sections and markers (Intro, Verse, Chorus), so a song gets a shape.
- Cloud sync and version history for written songs.
- Edit imported tabs (see the open questions on round-trip fidelity).
- A second voice per staff.
- Drum track entry.
- Lyrics under the tab.
- Record a riff, then turn it into notes. This needs pitch detection on the user's own audio
  and is the most distinctive item here; it needs a separate spike.

### Non-goals

- Standard-notation note entry. The notation still renders; you just don't edit it.
- Engraving and print layout control.
- MIDI keyboard or guitar-to-MIDI input.
- Real-time collaboration.
- Editing Guitar Pro 3/4/5 files without converting them to GP7 on save.

## Experience sketch

```
┌───────────────────────────────────────────────────────────────────────┐
│ ← Library   My New Riff   ♩=112  4/4   [Guitar ▾] [+ Track]   ⟲ ⟳  ▶ │
├───────────────────────────────────────────────────────────────────────┤
│ Duration: 𝅝 𝅗𝅥 ♩ [♪] 𝅘𝅥𝅯 𝅘𝅥𝅰   · dotted   3 triplet   rest             │
├───────────────────────────────────────────────────────────────────────┤
│  e|-----------------|-----------------|                               │
│  B|-----------------|-----------------|                               │
│  G|-----------------|-----------------|                               │
│  D|---------7-------|-----5-----------|                               │
│  A|-----7-------5---|-[ ]-------------|  ← cursor (beat 2, A string) │
│  E|-5---------------|-3---------------|                               │
│            bar 2 is ⅛ short ▲                                         │
└───────────────────────────────────────────────────────────────────────┘
```

Proposed keys (to confirm against Guitar Pro conventions in M1):

| Key | Action |
| --- | --- |
| `0`–`9` | Fret on the cursor string |
| `←` `→` / `↑` `↓` | Previous/next beat, string up/down |
| `+` / `-` | Shorter / longer duration |
| `.` | Toggle dotted |
| `r` | Rest |
| `Delete` / `Backspace` | Remove note, then beat |
| `Insert` | Insert a beat before the cursor |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Space` | Play from cursor |

The player already handles key presses in `src/playerView.ts` and `src/metronome.ts`. The
editor must own the keyboard while it is open, and those handlers must stand down.

## Architecture

Follows the repo conventions: logic in `shared/` (covered by vitest), browser code in `src/`.

- `shared/editor/cursor.ts`: cursor position (track, bar, voice, beat, string) and movement
  rules, such as wrapping to the next bar and skipping past the last beat.
- `shared/editor/commands.ts`: every edit as a command with `apply` and `invert` working on an
  alphaTab `Score`. Undo/redo is a stack of these. Each command reports the first master bar
  it changed, which goes straight into `RenderHints.firstChangedMasterBar`.
- `shared/editor/barCheck.ts`: bar fullness against the time signature.
- `shared/editor/newScore.ts`: builds an empty score from title, tempo, time signature and
  tracks/tunings. It reuses the tunings in `shared/music.ts`.
- `src/editorView.ts`: alphaTab with `includeNoteBounds`, the cursor overlay, the keyboard
  map, the toolbar, and the autosave.
- Server: a `PUT /api/songs/:id/tab` raw-body upload. Today `/tab` is GET-only. It replaces
  the tab file atomically, the same way `server/library.ts` writes `songs.json`.
- Entitlement: `server/cloud.ts` gains `getEntitlement()`, which the UI reads through
  `/api/cloud/status`.

The alphaTab model classes work in Node (the songbook tests already load scores there), so the
command layer can be tested without a browser. Each command test should check that
`Gp7Exporter` → re-import gives the same notes.

## Paywall and entitlement

**Mechanism.** The app already signs users in to Fretlane Cloud (`server/cloud.ts`, session in
`library/cloud.json`). The site (`mauritsE/fretlane-sync-magic`) has to expose the user's plan
somewhere the app can read with that session, such as a Supabase `profiles.plan` column or an
RPC. **That's work on the site, outside this repo, and it isn't designed yet.** The app caches
the last known entitlement with an expiry, so a premium user who is offline keeps editing for
a grace period (14 days is suggested).

**The honest caveat: Fretlane is MIT-licensed open source.** A check in the client can be
patched out by anyone who builds from source. Options:

1. **Accept it (recommended for v1).** People who build from source are few and are not the
   paying audience. The gate is a nudge, not a lock. The App Store and installer builds are
   what people pay for.
2. **Put the value where the server is.** The editor stays free in the code, and Premium sells
   what only a server can give: syncing written songs across devices, version history, and
   backups. This is harder to argue in marketing but impossible to bypass.
3. **Move premium code to a closed repo.** This breaks the "open source" story and complicates
   releases. Not recommended.

Recommendation: ship v1 with option 1 and plan v1.1 so that cloud sync and version history for
written songs (option 2) become the main reason to pay. Decide before pricing is announced.

## Milestones

| | Goal | Done when | Status |
| --- | --- | --- | --- |
| **M0 spike** | Prove editing works in alphaTab | One bar, arrow keys and digit entry change the score and re-render. Re-render time with `firstChangedMasterBar` is measured on a 200-bar demo score, and the numbers are written into this doc. | Done; numbers below |
| **M1 core entry** | Write a riff | Cursor, frets, durations, rests, chords, insert/delete; tests for `cursor`, `commands`, `barCheck` | Done (`tests/editor.test.ts`) |
| **M2 save + undo** | Keep what you wrote | New song dialog, autosave via `PUT /tab`, undo/redo, `.gp` export that opens in Guitar Pro and TuxGuitar | Done; the `.gp` was re-opened with alphaTab, **not yet in Guitar Pro or TuxGuitar** |
| **M3 bars + playback** | Build a song | Copy/paste bars, repeats, play from cursor, loop | Done |
| **M4 premium gate** | Charge for it | Entitlement from the site, cached offline grace, upsell screen; needs the site work | Done; no site work was needed. **Tested against a fake website only** |
| **M5 release** | Ship | `fretlane-verify` passes, e2e covers writing a 4-bar riff and reopening it, desktop build via `fretlane-release` | Verified locally (see notes); macOS/Windows CI not run |

## How we'll know it works

Fretlane has no analytics by design (see `wiki/Privacy-Policy.md`), and this spec doesn't
change that. The signals available:

- Premium sign-ups and churn, on the site.
- Count of written songs synced to the cloud, once v1.1 sync exists (server-side and
  aggregate only).
- Qualitative: 5 to 8 songwriters who use Guitar Pro write one real song in the editor. Watch
  where they reach for the mouse or get stuck.

No targets are set yet; set them after the first beta cohort, not before.

## Risks

| Risk | Mitigation |
| --- | --- |
| Re-rendering is too slow on long songs, so typing feels laggy | M0 measures it first. Fallbacks: render only the edited bar range in a page view, or batch keystrokes |
| Changing the alphaTab model leaves it inconsistent (forgotten `finish()`, stale beat indexes) | All edits go through `commands.ts`, and each test round-trips the result through the exporter |
| `.gp` export loses data from imported Guitar Pro files | v1 only edits songs created in Fretlane. Editing imports comes later, after a fidelity test on real files |
| Keyboard conflicts with the player and metronome shortcuts | The editor owns the keyboard while open; covered by e2e |
| The paywall is bypassable in an MIT project | See the options above. Move the value into server-backed features |
| Competing with Guitar Pro on features | Don't. Compete on "write it and practise it in one place, with your recording synced" |

## Open questions

1. **Price and plan shape.** Is this one Fretlane Cloud plan that includes the editor, or a
   separate Premium tier on top of storage? *v1 answer: the existing $5/month Fretlane Cloud
   plan (Stripe or Ko-fi) includes it. A separate tier would need a plan column on the site.*
2. **Should a free tier get a taste?** For example, edit up to 8 bars, or write freely but
   export only with Premium.
3. **Editing imported tabs:** when, and what to do with formats we can't save back to
   (MusicXML, ASCII). *v1 answer: "✎ Make my version" in the player makes an editable copy
   (alphaTex) and lists what the editor can't keep first; the original stays untouched.*
4. ~~**Site work for entitlement:** who builds it, and what is the schema?~~ *Not needed: the
   site's `subscriptions` table and `my_kofi_membership()` RPC already answer it.*
5. **Naming:** "Fretlane Premium", "Fretlane Studio", or "Write mode"?

## Implementation notes (v1)

**What shipped.** Everything in the MVP list, plus two items from "Next" that came cheap once
the document model existed: techniques (hammer/pull, slide, vibrato, full bend, palm mute, let
ring, dead note, tie) and section names. Also time signature and tempo changes per bar, 4–8
string tunings (presets plus custom), several guitar/bass tracks, and "✎ Make my version" for
tabs not written in Fretlane. Not built: cloud sync of written songs, second voices, drums,
lyrics, recording a riff into notes.

**Files.** `shared/editor/doc.ts` (document, ticks, rest filling, bar status, tunings),
`shared/editor/commands.ts` (every edit as a pure function, plus undo history),
`shared/editor/tex.ts` and `fromScore.ts` (to alphaTex and back), `shared/premium.ts` (plan
rules), `server/cloud.ts#premium()`, `PUT /api/songs/:id/tab`, `GET|POST /api/premium`,
`src/editorView.ts` (route `#/write/<id>`), `src/writeDialog.ts`, `src/premiumView.ts`,
`src/pluck.ts`. Tests: `tests/editor.test.ts`, `tests/premium.test.ts`, additions to
`tests/cloud.test.ts` and `tests/library.test.ts`, and `e2e/editor.ts` (`npm run e2e:editor`).

**Different from the plan, and why.**
- *An editor document instead of commands that change alphaTab's `Score`.* The M0 spike showed
  that changing the model and calling `score.finish()` again works (under 1 ms for 200 bars,
  and it round-trips through both exporters). But a plain document makes every edit a pure
  function, undo a stack of documents, and copy/paste a deep copy. All of it is tested in
  vitest without alphaTab objects. Each edit re-parses alphaTex: 11–38 ms for 400 bars in Node.
- *Stored as alphaTex, exported as `.gp`.* `Gp7Exporter` took 130–420 ms for 200 bars in Node,
  too slow to run on every autosave. alphaTex export is a string join, the normal player already
  plays it, and the file stays readable. **⤓ .gp** exports for Guitar Pro / TuxGuitar /
  MuseScore, so principle 3 (open files) still holds.
- *Bars keep themselves full.* A new bar is one rest, a note replaces a rest, a longer note takes
  room from the rests after it, a shorter one leaves a rest. Notes are never dropped to make
  room: a bar that still doesn't add up gets a red tint and "⚠ an eighth too long".
- *Hearing notes.* alphaTab's `playNote()` races with the MIDI reload that every edit triggers.
  Its Web Audio output starts asynchronously, and the browser throws "cannot call stop without
  calling start first". The editor plays typed notes with its own plucked-string voice
  (`src/pluck.ts`, Karplus–Strong). Space still plays the song through alphaTab with the track's
  real instrument. For the same reason, a pause, a stop or a re-render in the first 300 ms after
  play waits until those 300 ms have passed.
- *Plan check without site work.* The app asks the website the way its own account page does:
  the user's newest `subscriptions` row (Stripe) and `my_kofi_membership()` (Ko-fi), both
  limited to the user by row-level security. Answers are cached for 10 minutes. The last answer
  is kept in `library/premium.json` for a 14-day offline grace, never past the paid period.
- *Mac App Store.* By the user's decision, the Mac App Store build includes the editor without a
  plan (`premiumIncluded: !!process.mas`). Buyers already paid €4.99, and Apple's guideline 3.1.1
  doesn't allow unlocking features with an outside purchase. Source and GitHub/desktop builds
  check the plan. The release skill records this as the one allowed gate.

**M0 numbers.** Time from an edit to alphaTab's `postRenderFinished` on a 201-bar guitar song
(alphaTex re-parse + `renderScore` with `firstChangedMasterBar`), median of 5 keystrokes,
headless Chromium in a cloud container, over 15 runs of `e2e/editor.ts` during development.
Typing near the end of the song took 45–150 ms (usually 50–60); typing in bar 1 took 51–128 ms.
That is fast enough that no fallback was needed. A real desktop machine will differ.

**Keys as built.** As proposed, plus: Ctrl+←/→ by bar, Shift+←/→ selects bars, Home/End,
`I` = Insert, Shift+T triplet, H S V B P L X T for techniques, Ctrl+C/X/V bars, Ctrl+Delete
deletes bars, Esc clears the selection, `?` lists them all. `+` = shorter note, `−` = longer
(the Guitar Pro direction). The editor listens in the capture phase and stops the keys it uses,
so the metronome's `M`/`T` shortcuts don't fire while typing techniques.

**Verified, and not.** Verified: unit tests (`npm test`); `e2e/editor.ts` against a fake
website and Supabase: upsell, unlock, typing, the caret within 1 px of alphaTab's note heads,
undo, bars, autosave and reopen, playback, tracks, `.gp` re-import, "Make my version", and 402
once the plan ends. The existing smoke, cloud and desktop e2e suites still pass. **Not
verified:**
- the real website's RLS letting the app's session read `subscriptions` and call
  `my_kofi_membership()`. Check this by signing in with a paying account.
- opening the exported `.gp` in Guitar Pro or TuxGuitar.
- how the plucked voice sounds on real speakers.
- the editor inside the Electron window (the desktop e2e doesn't open it).
- macOS/Windows release CI.
