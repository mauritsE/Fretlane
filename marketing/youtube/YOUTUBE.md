# YouTube kit

Everything in `out/` is ready to upload. The copy below is written in your voice, so change anything that doesn't sound like you.

| File | What | Length |
| --- | --- | --- |
| `fretlane-walkthrough.mp4` + `thumbnail-walkthrough.jpg` | Narrated full tour with chapters, 1920×1080 | 3:26 |
| `fretlane-walkthrough.srt` | Captions for the tour (upload them, don't burn them in) | |
| `chapters.txt` | Chapter timestamps for the description | |
| `fretlane-trailer.mp4` + `thumbnail-trailer.jpg` | The LinkedIn demo with a "link in the description" end card, 1920×1080, captions burned in | 1:37 |
| `../instagram/out/reel-*.mp4` | Four vertical Reels. Upload them as Shorts unchanged | 16–42 s |

## What's real
- **Every app screen is a screen recording of Fretlane** (production build, fresh library), driven by
  `record.ts` with Playwright. The only thing added to the page is a visible mouse pointer.
- **The music is what the app played during that recording**, captured from the page itself, so the
  cursor and the sound line up. The narration ducks it a little. Shots without app sound are sped up
  by at most 1.3×, and the build refuses to speed up a shot that has audible sound.
- **YouTube sync (2:32–2:51) is your own recording** of "Animals" synced to its YouTube video, cut
  from `../fretlane-demo.mp4` because the cloud session can't reach YouTube. Its label says so.
- **Drawn frames:** the title, "Syncing a tab to a recording" (steps from the README, labelled as
  not an app screen), "Get Fretlane" and the end card.
- **Voice:** local AI voice (Kokoro, `am_michael`), the same as the LinkedIn video. To use your own
  voice, record the lines in `fretlane-walkthrough.srt`. A real voice will do better on YouTube.

## ⚠ Content ID
Both videos contain your "Animals" (Architects) sync footage: the official music video in the
corner (no sound) and a tab of a copyrighted song. YouTube's Content ID may claim it. A claim usually
means ads or a block in some countries, not a strike, but it's worth avoiding on a promo video.
`python3 marketing/youtube/build.py walkthrough --no-sync-footage` builds the tour without it
(about 19 s shorter, and the sync section then only has the steps card). The trailer can't drop it
without re-cutting the LinkedIn video. Safest: record a new sync clip of one of the songbook songs
(public domain) with a YouTube video you made yourself, and swap it in.

## Long-form: the walkthrough

**Title** (pick one):
- Fretlane: a free guitar tab player where the whole band plays along (full tour)
- Free Songsterr alternative? Fretlane tab player, full tour
- I built a free, open-source guitar tab player. Here's everything it does

The second title gets search traffic but invites comparison. Use it only if you're fine with that.

**Description:**
> Fretlane is a free, open-source guitar tab player. Open a song and melody, rhythm guitar, bass and drums all play, with a cursor that follows every note. Slow it down, loop the hard bars, add a count-in and a click track, and bring your own Guitar Pro, MusicXML or plain-text tabs. Link a YouTube video or Spotify track and the tab follows the recording.
>
> ⬇ Download (Mac, Windows, Linux): https://github.com/mauritsE/Fretlane/releases/latest
> 💻 Source code: https://github.com/mauritsE/Fretlane
>
> No account, no uploads. Your songs are plain files in a folder on your own computer.
>
> 0:00 Intro
> 0:10 The library
> 0:24 Play along
> 0:56 Practice tools
> 1:29 Metronome
> 1:50 Favorites and archive
> 2:07 Your own tabs
> 2:32 YouTube and Spotify sync
> 3:08 Download
>
> Fretlane ships 22 public-domain songs in its own arrangements. It does not include or download anyone else's tabs.
> Built with alphaTab. I'm a product manager, not a programmer, and built it with Claude Code.

If you build with `--no-sync-footage`, take the chapters from the new `out/chapters.txt`.

**Tags:** guitar tabs, tab player, guitar practice, guitar pro, songsterr alternative, free guitar software, learn guitar, bass tabs, drum tabs, metronome, open source, alphatab

**Settings:** category *Music* or *Education*; language English; upload `fretlane-walkthrough.srt` under
Subtitles → English; *Altered or synthetic content*: the rule targets realistic footage that could be mistaken for real events, so an AI narrator over screen recordings probably doesn't need it; ticking it costs nothing if you're unsure; not made for kids.

**Pinned comment:**
> What's missing for how you practise? I read every comment, and the most-asked feature goes in next.

**End screen** (last 20 s, from 3:06): a "Subscribe" element plus a playlist of the Shorts.

## Short-form: the trailer
Post it a few days after the tour, or use it as the channel trailer (Channel → Customisation → Layout).

**Title:** Fretlane: a free guitar tab player where the whole band plays along
**Description:** same as above, without the chapters (the trailer has none).

## Shorts
Upload the four Reels from `../instagram/out/` as they are. Use the Reel captions from
`../instagram/INSTAGRAM.md` as titles and put the download link in each description. Shorts can't
have clickable links in descriptions, so add *Related video* → the walkthrough on each Short.

## Order
1. Walkthrough (day 1), pinned comment, add it to a "Fretlane" playlist.
2. One Short every 2–3 days: band → practice → paste → archive.
3. Trailer as the channel trailer.
4. Share the walkthrough link in the Reddit and Show HN posts (`../instagram/OTHER_CHANNELS.md`).
