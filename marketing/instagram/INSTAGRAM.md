# Instagram kit

Everything in `out/` is ready to upload. Written in your voice; change anything that doesn't sound like you.

| File | What | Size |
| --- | --- | --- |
| `reel-band.mp4` + `reel-band-cover.jpg` | The whole band plays along, switch to bass and drums | 23 s |
| `reel-paste.mp4` + `reel-paste-cover.jpg` | Paste a plain-text tab, it becomes a playable tab | 21 s |
| `reel-practice.mp4` + `reel-practice-cover.jpg` | Half speed, loop, metronome, tap tempo | 42 s |
| `reel-archive.mp4` + `reel-archive-cover.jpg` | Favorites and the archive ("mark as done") | 16 s |
| `carousel-1.jpg` … `carousel-6.jpg` | Feed carousel, 4:5 | 1080×1350 |
| `story-1.jpg`, `story-2.jpg`, `story-3.jpg` | Launch story, poll story, link story | 1080×1920 |
| `profile.png` | Profile picture (Instagram crops it to a circle) | 1080×1080 |
| `social-preview.png` | Link card for GitHub, X, Bluesky, LinkedIn, Reddit | 1280×640 |

**What's real:** every app shot is a screen recording of Fretlane. The sound in the band, paste and
practice Reels is what the app played during that recording, captured from the app itself, so the
cursor and the music line up. The archive Reel had no sound, so it has Fretlane's own synthesizer
playing Greensleeves underneath. The riff in the paste Reel is original. Captions, the frame and the
end card are the only drawn parts. The Reels say "Real screen recording · sound from the app" under
the footage; keep it, it's true and it builds trust.

## Set up the profile

- **Name:** Fretlane (or your own name with Fretlane in the name field, e.g. `Maurits · Fretlane`, if you post as yourself)
- **Profile picture:** `profile.png`
- **Bio** (150 characters max):
  > Building Fretlane: a free guitar tab player where the whole band plays along 🎸 Open source · Mac, Windows, Linux ↓
- **Link:** https://github.com/mauritsE/Fretlane/releases/latest (the downloads). The end cards and stories say "link in bio", so set this before you post anything.
- **Highlights:** after the first week, save story-1 and story-3 into a highlight called "Download".

## Posting plan (two weeks)

| Day | Post | Story |
| --- | --- | --- |
| 1 | Carousel (all 6 slides) | story-1, then story-3 with a link sticker |
| 3 | Reel: band | Share the Reel to your story |
| 6 | Reel: paste | |
| 9 | Reel: practice | story-2 with a poll sticker |
| 12 | Reel: archive | Post the poll results, say what you'll build next |

Post in the evening (Dutch time works fine for a European audience) and reply to every comment in the first hour.

### Uploading a Reel
1. Upload the `.mp4` as a Reel, not a post.
2. **Edit cover → add from camera roll** → the matching `-cover.jpg`. Check the grid preview: the title sits in the safe area of the 3:4 crop.
3. Keep the **original audio**. If you add a trending track, mute it under the app's sound or drop it: the point is hearing that the tab plays.
4. Turn on **auto-generated captions** only if you add a voiceover; the on-screen text already tells the story.
5. Leave "Also share to feed" on.

The same files work as YouTube Shorts and TikToks. On TikTok a clickable bio link needs 1,000 followers, so say "search Fretlane on GitHub" there instead.

### Stories
- **story-2:** add Instagram's poll sticker in the outlined box. Options: "Fast parts" / "Rhythm and timing" (or a quiz sticker with: fast parts, rhythm, reading tab, staying motivated).
- **story-3:** add the link sticker in the outlined box, pointing at the releases page.

## Captions

Instagram allows at most 5 hashtags per post, so each caption ends with 3–5.

### Carousel (day 1)
> I've played drums since I was 12, and for years I wrote songs for my bands in Guitar Pro with a guitar on my lap. What I never had was a practice tool that felt like an instrument instead of software.
>
> So I built one. It's called Fretlane 🎸
>
> 🎵 Open a song and the whole band plays: melody, rhythm guitar, bass and drums
> 🐢 Slow it down, loop the bar you keep missing
> ⏱️ A metronome that starts at the song's tempo
> 📂 22 songs built in, or bring your own Guitar Pro or text tabs
>
> Free and open source, for Mac, Windows and Linux. Link in bio.
>
> What's the first song you'd load into it?
>
> #guitarpractice #guitartabs #learnguitar #opensource #sideproject

### Reel: band (day 3)
> Most tabs are silent. In Fretlane the whole band plays along, and you can switch to the bass line or the drum part without stopping. 🎸🥁
>
> This is "In the Hall of the Mountain King" from the built-in songbook. The sound is the app itself, nothing added.
>
> Free download, link in bio.
>
> #guitartabs #guitarpractice #bassguitar #drums #learnguitar

### Reel: paste (day 6)
> Found a tab online that's just text? Paste it into Fretlane and it turns into a real tab you can hear, with a cursor that follows every note.
>
> (The riff is one I made up for this video. Plain-text tabs don't say how long notes are, so Fretlane plays every column evenly. Guitar Pro files keep the exact rhythm.)
>
> Free, open source, link in bio.
>
> #guitartabs #guitarriff #learnguitar #guitarpractice #opensource

### Reel: practice (day 9)
> Für Elise at full speed is not where you start.
>
> ➡️ Drop it to half speed
> 🔁 Drag across the bars you keep messing up and loop them
> ⏱️ Turn on the metronome: it starts at the song's tempo, or tap in your own
>
> All in Fretlane, my free guitar tab player. Link in bio.
>
> #guitarpractice #furelise #classicalguitar #learnguitar #metronome

### Reel: archive (day 12)
> The most satisfying button in the app: "Mark as done" ✅
>
> Star the songs you're learning, and when you've actually got one down, it moves to your archive. Watching that list grow is the best motivation I've found.
>
> Fretlane is free and open source. Link in bio.
>
> #guitarpractice #learnguitar #guitarjourney #practicemotivation #opensource

## Before you post, check
- **Publish a new release first.** The latest download is v0.1.1 (30 September), which predates the
  22-song songbook, the metronome, favorites, the archive and the drum-track fix: most of what these
  posts show. Release v0.2.0 from current `main` (the `fretlane-release` skill walks through it), or
  people who click "link in bio" get an app that doesn't match the videos.
- The drummer and Guitar Pro details come from what you've told me about yourself. Adjust anything that doesn't sound like you.
- The built-in songs are public-domain tunes (Greensleeves, Für Elise, House of the Rising Sun…), not chart hits. If someone asks for a specific pop song, that works through importing their own tab, not bundled.
- YouTube sync is mentioned in carousel slide 5. These Reels don't show it, because the sandbox that recorded them can't reach YouTube. Your own recording (`marketing/work/youtube-sync.mov`, used in the LinkedIn video) would make a strong fifth Reel; see "Your own footage" in `README.md`.
