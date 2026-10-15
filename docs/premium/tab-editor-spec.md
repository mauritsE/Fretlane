# Fretlane Premium: the tab editor

Status: draft for review · Owner: Maurits · Last updated: 2026-10-15

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
validation and the save path. How fast a re-render is with `firstChangedMasterBar` on a long
score is **not measured yet**; milestone M0 exists to measure it.

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
- Saves into the library as a normal song (`tabFormat: 'gp'`), autosaved after each edit
  (debounced), so it shows in the library grid like any other song.
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

| | Goal | Done when |
| --- | --- | --- |
| **M0 spike** | Prove editing works in alphaTab | One bar, arrow keys and digit entry change the score and re-render. Re-render time with `firstChangedMasterBar` is measured on a 200-bar demo score, and the numbers are written into this doc. |
| **M1 core entry** | Write a riff | Cursor, frets, durations, rests, chords, insert/delete; tests for `cursor`, `commands`, `barCheck` |
| **M2 save + undo** | Keep what you wrote | New song dialog, autosave via `PUT /tab`, undo/redo, `.gp` export that opens in Guitar Pro and TuxGuitar |
| **M3 bars + playback** | Build a song | Copy/paste bars, repeats, play from cursor, loop |
| **M4 premium gate** | Charge for it | Entitlement from the site, cached offline grace, upsell screen; needs the site work |
| **M5 release** | Ship | `fretlane-verify` passes, e2e covers writing a 4-bar riff and reopening it, desktop build via `fretlane-release` |

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
   separate Premium tier on top of storage?
2. **Should a free tier get a taste?** For example, edit up to 8 bars, or write freely but
   export only with Premium.
3. **Editing imported tabs:** when, and what to do with formats we can't save back to
   (MusicXML, ASCII). Proposed answer: save as a new `.gp` copy and keep the original.
4. **Site work for entitlement:** who builds it, and what is the schema?
5. **Naming:** "Fretlane Premium", "Fretlane Studio", or "Write mode"?
