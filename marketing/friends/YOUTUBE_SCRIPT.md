# YouTube demo videos for Fretlane 0.3: recording script

Three videos plus Shorts, for you to record yourself: your screen, your voice, and ideally your hands on a guitar. The earlier walkthrough (`../youtube/`) used an AI voice and a scripted browser. These are meant to be the opposite: you, really using it.

| # | Video | Length | Why |
| --- | --- | --- | --- |
| 1 | **What's new in Fretlane 0.3** | 4–5 min | The video the Facebook post and story point to |
| 2 | **Writing a song from scratch, with the riff assistant** | 8–10 min | The deep dive. Shows the editor and a real AI answer |
| 3 | **Play along with your band's rehearsal recording** | 3–4 min | The most personal use case, and the one nobody else does |
| S | **3 Shorts** cut from 1–3 | 30–50 s each | Reach. Vertical crops of the best moments |

Record video 2 first: it produces the song you need for video 1.

---

## Before you record

**Setup**
- Screen recording at 1920×1080: OBS, or QuickTime on the Mac (File → New Screen Recording). Record the Fretlane window only, not the whole desktop.
- Turn on Do Not Disturb, close Slack and mail, and hide the Dock and your bookmarks bar.
- Use a fresh library so no personal or copyrighted tabs show up. On the Mac, rename `~/Fretlane` to `~/Fretlane-real` while you record, then rename it back.
- App zoom: `Cmd +` once, so the text is readable on a phone.
- Use a headset or a USB mic, not the laptop mic. Record the voice-over separately if talking while clicking feels awkward. That's normal.
- Sign in to Fretlane Cloud with your own account, so the editor and the assistant are unlocked. Check that the usage bar has enough bars left (video 2 uses about 10–20).

**Copyright (Content ID)**
- Only use songs that are yours or public domain: the built-in songbook (Greensleeves, House of the Rising Sun, Hall of the Mountain King…), songs you write in the video, and recordings of your own band.
- No YouTube or Spotify links to commercial songs on screen, and no "Animals" sync footage. A Content ID claim on your own demo video is annoying and avoidable.

**Your hands**
- Prop a phone on a stand pointing at your fretboard and hit record whenever you play. You'll use it as picture-in-picture or as a cutaway. Even 5 seconds of a real person playing along makes these videos feel less like an ad.

**Talking**
- Keep it short, the way you write: one or two sentences per shot, then let the app play. The lines below are a guide, not something to read out.

**Honesty rules (yours, from the other kits)**
- Show the assistant's first answer, even if it's meh. Then show ⟳ Try again or improve it by hand. People trust a demo that shows a miss.
- Don't speed up footage that has app sound in it.
- If something breaks while recording, keep it and write it down. It's a bug report.

---

## Video 1: What's new in Fretlane 0.3 (4–5 min)

**Prepare:** the song you wrote in video 2 (or "Trail Run" from `capture.ts`), an audio file of your own (rehearsal take or backing track) linked to a songbook song with bar 1 pinned, and a Cloud tab in your account.

| Time | On screen | You say (roughly; your own words beat reading) |
| --- | --- | --- |
| 0:00 | **You on camera**, or your hands playing a riff | "This is Fretlane, a guitar tab player I'm building. Version 0.3 is out. You can now write songs in it. I'll show you." |
| 0:15 | Library, quick scroll | "Short recap: you open a song and the band plays along. 25 songs are built in, and you can add your own Guitar Pro files. Free." |
| 0:30 | Click **✎ Write** → New song dialog → title, guitar + bass + drums → create | "New: ✎ Write. I start a new song and pick guitar, bass and drums." |
| 0:50 | Type a riff on the guitar track: digits, arrows, **P.M.** | "You type fret numbers and hear each note. Arrows to move around." |
| 1:30 | Press **?** to show the shortcut list for 2 s, close | "Question mark shows all shortcuts." |
| 1:40 | Click the **Drums** track, ↑ ↓ to pick a drum, Enter to add hits | "Drums. Up and down picks the drum, Enter adds a hit." |
| 2:10 | ▶ Play: the whole thing plays back | (Let it play for 5–8 s without talking.) |
| 2:20 | Select bars (Shift + → →), type in the **Riff assistant**: "a bass line that follows this riff" → Write | "The riff assistant. I select these bars and ask for a bass line that follows the guitar. It reads the whole song first." |
| 2:45 | The answer lands. ▶ Play it | "This is what it wrote." (Then say what you think, in one sentence.) |
| 3:05 | ⟳ Try again, or fix one note by hand. Point at the usage bar | "Don't like it? Try again, undo, or change it yourself. The bar below shows how much I used this month." |
| 3:25 | **⤓ .gp** in the toolbar | "Everything exports to Guitar Pro." |
| 3:35 | Back to library → a songbook song with your audio file → **⇆ Sync** panel with the waveform | "Second thing: play along with your own recordings. I click the first beat in the waveform, it snaps to the note, pin. Now the tab follows." |
| 4:00 | Speed to 70%, play | "Slower, same pitch." |
| 4:15 | **☁ Cloud** in the library, Add & open a tab | "If you use Fretlane Cloud, your tabs open here too, and songs you write are backed up." |
| 4:30 | End card or you on camera | "Playing along is free, no account needed. Writing and the assistant are in Fretlane Cloud, $5 a month. Link in the description. If something doesn't work, let me know." |

**Title options**
- I built a guitar tab player. Now it writes songs too (Fretlane 0.3)
- Write guitar, bass & drum tabs with an AI riff assistant | Fretlane 0.3
- Fretlane 0.3: tab editor, drums, riff assistant and your own recordings

**Description**
> Fretlane is a guitar tab player I'm building: open a song and the whole band plays along, with the tab following the music. Version 0.3 adds a tab editor for guitar, bass, drums, ukulele, mandolin and banjo, a riff assistant that writes parts that fit your song, play-along with your own audio files, and Guitar Pro export.
>
> ⬇ Download (Mac, Windows, Linux): https://fretlane.app
> 💻 Source code: https://github.com/mauritsE/Fretlane
>
> Playing along is free and needs no account. The editor and the riff assistant come with Fretlane Cloud (from $5/month).
>
> [chapters: fill in after editing, e.g. 0:00 Intro · 0:30 Writing a song · 1:40 Drums · 2:20 Riff assistant · 3:25 Guitar Pro export · 3:35 Your own recordings · 4:15 Fretlane Cloud]
>
> Every song in this video is either public domain or written by me. I'm a product manager, not a programmer, and I built Fretlane with Claude Code.

---

## Video 2: Writing a song from scratch, with the riff assistant (8–10 min)

This one is a real session, not a feature tour. Have a rough idea for a riff before you hit record, but don't rehearse the whole thing. The point is to show how it feels to use.

**Structure**

1. **Cold open (0:00–0:20).** Play 10 seconds of the finished song from the end of the session. "I'm going to write this, from an empty page, with some help."
2. **The idea (0:20–1:30).** Pick up the guitar, play your riff idea on camera. Then: "Let's put it in Fretlane." ✎ Write → new song, set tempo and time signature.
3. **Typing the riff (1:30–3:30).** Type it in. Narrate what you do: durations (the note buttons, or the keys from **?**), palm mutes, a hammer-on, a rest. Show that **bars fill themselves with rests** and flag when they don't add up. Make one mistake and Ctrl+Z it.
4. **Sections (3:30–4:00).** § Section: name it "Riff". Copy the bars, paste them, change the ending.
5. **Ask for a bass line (4:00–5:30).** Select the bars, prompt something specific ("a bass line that locks in with the palm-muted chugs, simple, root notes with a fill at the end"). Show the answer, play it. Your honest opinion. Try again once if it's off, and say why.
6. **Ask for drums (5:30–6:30).** "Drums: a straight rock beat, crash on bar one, a tom fill into the repeat." Play it. Say out loud whether the fill is playable and the kick makes sense.
7. **Write something new (6:30–7:30).** Move the cursor past the end, nothing selected, ask for a new section ("a half-time breakdown that answers the riff"). Show that it writes from the cursor bar and adds it, and that the song's key and chords carry over.
8. **Fix it by hand (7:30–8:30).** Change a few notes of the AI part so it's yours. "It's a starting point."
9. **Play it all, export (8:30–9:15).** ▶ Practise in the player at 100%, then ⤓ .gp. Optional: open the .gp file in Guitar Pro or TuxGuitar to show it's a normal file.
10. **Close (9:15–9:45).** On camera with the guitar: play along with what you wrote. "That's it. The assistant is in Fretlane Cloud. Link below."

**Things to say about the assistant (true, and worth saying)**
- It reads the whole song (every track, every bar) before it writes, so a bass line follows your guitar instead of being generic.
- It checks its own answer for things a guitarist would catch (bars that don't add up, unplayable stretches, frets that don't exist, notes outside the key) and corrects them once before you see the result.
- One bar on one track counts as one assistant bar. The $5 plan has 96 a month, enough for a few songs' worth of experiments.
- It's Claude, through the Fretlane website. Your song is sent there to get an answer. Say that plainly.

**Title options**
- Writing a song from scratch with an AI riff assistant (guitar, bass & drums)
- Can an AI write a bass line that fits my riff? Testing Fretlane's riff assistant
- From riff idea to full band in 10 minutes | Fretlane tab editor

The second one works best if the video really is a test, including the misses.

---

## Video 3: Play along with your band's rehearsal recording (3–4 min)

**Prepare:** a recording of your own band (old rehearsal, demo, live take) and a tab of that song. If you don't have the tab, write it in the editor first: that can be its own Short.

| Time | On screen | You say |
| --- | --- | --- |
| 0:00 | You on camera, or a photo of the old band | "A rehearsal recording of an old band of mine. I want to play along with the tab, and slow down the parts I forgot." |
| 0:20 | + Add song (or ✎ edit the song) → **🎵 Audio file** → pick the file | "Add the song, click Audio file, pick the recording. It stays on your computer." |
| 0:45 | Open the song → **⇆ Sync** → the waveform | "Sync. I click the first beat of bar 1 in the waveform. It snaps to the note. Pin." |
| 1:15 | Play: the cursor follows | "And now the tab follows the recording." |
| 1:30 | Zoom the waveform (−/+), add a second pin later in the song | "Bands drift. I pin another bar later on, and the tab follows that too." |
| 2:00 | **Tap along (T)** briefly | "Or tap T on every downbeat while it plays." |
| 2:20 | Speed 60%, loop a tricky part (drag over bars, **L**) | "Slow it down, loop the hard part. Pitch stays the same." |
| 2:45 | Your hands playing along (phone footage), app in the corner | (Play. No talking.) |
| 3:15 | Close | "Works offline, with MP3, WAV, FLAC, OGG or M4A. It's in the free version. Link below." |

**Title options**
- Play along with your old band's rehearsal recordings (synced guitar tab)
- Sync a guitar tab to any MP3, then slow it down | Fretlane

---

## Shorts (vertical, 30–50 s)

Crop to 1080×1920. Burn in captions: most people watch muted.

1. **"I asked an AI for a bass line"** (from video 2, step 5): prompt → answer → play → your one-line verdict. Hook text: *"Can an AI write a bass line for my riff?"*
2. **"Drummer writes drums"** (from video 1, 1:40, or video 2, step 6): typing a beat with ↑ ↓ and Enter, then it plays. Hook: *"Writing a drum part in Fretlane"*
3. **"My old band, synced"** (from video 3): the waveform pin, then your hands playing along at 70%. Hook: *"Playing along with a 15-year-old rehearsal tape"* (if that's true; adjust the number).

---

## After recording
- Send me the raw files (or put them in `marketing/work/`) and I can cut them with ffmpeg: captions, chapters, end cards and thumbnails in the same style as `../youtube/`.
- Note every bug you hit while recording. Each one is a quick fix before these go public.
