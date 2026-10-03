# Other channels

The same assets travel: the Reels work as YouTube Shorts and TikToks, `social-preview.png` is the
link card, and the landscape LinkedIn video (`../fretlane-demo.mp4`, post in `../LINKEDIN_POST.md`)
covers LinkedIn and YouTube.

## GitHub (do this first, every other link points here)
- **Settings → General → Social preview → Upload** `social-preview.png`. Every link to the repo on X,
  Bluesky, LinkedIn, Slack, Discord and Reddit then shows the card instead of GitHub's default.
- Repo **About** text: "Free guitar tab player where the whole band plays along. Guitar Pro, MusicXML and text tabs, YouTube sync. Mac, Windows, Linux."
- Topics: `guitar`, `guitar-tabs`, `music`, `alphatab`, `electron`, `typescript`, `practice`.

## Reddit
Each subreddit has its own self-promotion rules; read the sidebar before posting. Several only allow
it on a weekly thread. Post as a person, answer every comment, and don't post the same text to five
subreddits on the same day.

**r/SideProject, r/opensource** (self-promotion welcome). Title:
> I built a free, open-source guitar tab player where the whole band plays along

Body:
> I've played in bands since I was 12 and wrote songs in Guitar Pro, but never had a practice tool I liked. So I built Fretlane.
>
> - Open a song and melody, rhythm guitar, bass and drums all play, with a cursor that follows the tab
> - Speed from 25% to 150%, loop any range, count-in, click track
> - Metronome that picks up the song's tempo, with tap tempo
> - 22 public-domain songs built in; import Guitar Pro, MusicXML, alphaTex or pasted text tabs
> - Link a YouTube video and the tab follows it, bar by bar
> - Local-first: your library is a folder on your own computer, no account
>
> Desktop app for Mac, Windows and Linux. MIT licensed, built on alphaTab: https://github.com/mauritsE/Fretlane
>
> I'm a product manager, not a programmer, and built it with Claude Code. Happy to talk about that too. Feedback very welcome, especially from people who teach.

**r/guitar, r/guitarlessons, r/Bass** (strict rules, check the weekly self-promo thread). Shorter, lead with the problem:
> Made a free tab player for practising: the whole band plays along, you can slow it to half speed and loop the hard bars, and it imports Guitar Pro and text tabs. Open source, no account. Would love to hear what's missing for how you practise.

## Hacker News (Show HN)
Title (80 chars max):
> Show HN: Fretlane – open-source guitar tab player where the whole band plays

Text:
> Fretlane plays guitar tabs with the whole band (melody, rhythm, bass, drums) and a cursor that follows the notes. It imports Guitar Pro, MusicXML, alphaTex and plain-text tabs (converted to alphaTex), and can sync a tab to a YouTube video with per-bar sync points.
>
> It's vanilla TypeScript + Vite on top of alphaTab, with a small Node server that keeps the library as a JSON file plus tab files in a folder. The desktop app is Electron running the same server in-process. The built-in songbook is generated from note names and chord symbols; a test renders every song through alphaTab and checks it plays the written pitches.
>
> I'm a PM, not an engineer; I built it with Claude Code. Happy to answer questions about any of it.
>
> https://github.com/mauritsE/Fretlane

HN readers will ask what was hard; the YouTube ↔ alphaTab clock bridge and the ASCII-tab rhythm limitation are honest answers.

## X / Bluesky / Mastodon / Threads
Attach `reel-band.mp4` (all four accept vertical video) and let the link card do the rest.

> I built a free guitar tab player where the whole band plays along 🎸
>
> Slow it down, loop the hard bars, switch to the bass or drum part. Imports Guitar Pro and text tabs. Open source, Mac/Windows/Linux.
>
> https://github.com/mauritsE/Fretlane

Thread follow-ups, one per Reel: paste ("plain-text tab in, music out"), practice ("half speed + loop + metronome"), archive ("the most satisfying button").

## YouTube
- **Shorts:** upload the four Reels as they are; use the Reel captions as descriptions, and put the GitHub link in the description.
- **Long-form:** `../fretlane-demo.mp4` (96 s, narrated, captions burned in). Title: "Fretlane: a free guitar tab player where the whole band plays along".
