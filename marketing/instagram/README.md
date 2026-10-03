# Instagram and social assets

Ready-to-post files are in `out/`; captions, posting plan and checklist are in
[`INSTAGRAM.md`](INSTAGRAM.md); copy for Reddit, Hacker News, X/Bluesky and YouTube is in
[`OTHER_CHANNELS.md`](OTHER_CHANNELS.md).

## How it's made
- `record.ts` drives the real app (production build, fresh library) with Playwright on an 864×1080
  viewport at 1.25× (1080×1350 frames, wide enough to keep the track list). One "take" per Reel:
  `band`, `practice`, `paste`, `archive`. The only thing added to the page is a visible mouse pointer.
- **Sound** is captured from the page: every Web Audio node the app connects to the speakers is also
  connected to a MediaRecorder (with a silent keep-alive source so pauses stay pauses), stamped with
  wall-clock time and lined up with the screencast frames. So what you hear is what the app played:
  synth, half speed, the loop and the metronome clicks.
- The practice take checks itself: it fails unless the bar counter jumps back while looping.
- `build.py` cuts each take into shots, adds the caption, frame and end card, and encodes
  1080×1920 / 30 fps / H.264 + AAC at about −14 LUFS. It refuses to speed up a shot that has audible
  sound, so the picture and the music can't drift apart. Also writes a cover per Reel.
- `stills.py` makes the carousel, stories, profile picture and `social-preview.png` from real frames
  of the same takes plus a landscape screenshot (`screenshot.ts`).

## Rebuild

```bash
npm run build
FRETLANE_PORT=5183 FRETLANE_LIBRARY=/tmp/fresh-lib npx tsx server/index.ts --serve-dist &
npx tsx marketing/instagram/record.ts http://localhost:5183          # all takes, or name some: band paste
npx tsx marketing/instagram/screenshot.ts http://localhost:5183
npx tsx marketing/export-audio.ts http://localhost:5183 "Greensleeves" marketing/work/ig/greensleeves.wav
python3 marketing/instagram/build.py                                  # --preview writes stills of each shot instead
cd marketing/instagram && python3 stills.py
```

Needs ffmpeg, Pillow, and Inter as TTF in `marketing/work/fonts/` (`Inter-400.ttf` … `Inter-900.ttf`,
`InterDisplay-800/900.ttf`, from https://github.com/rsms/inter/releases). The library must be fresh:
the paste take adds "My riff" and the archive take stars and archives songs.

To change a caption or a cut, edit the `REELS` table at the top of `build.py`. Shots point at named
markers from `record.ts`, so re-recording doesn't break the edit.

## Your own footage
A Reel with your own hands on a guitar playing along will beat any screen recording. Film it vertical,
then put it in as a shot: drop the clip in `marketing/work/ig/`, and either cut it in with
ffmpeg, or ask Claude to add a `src=` option to `build.py` shots (the LinkedIn `build.py` has one).
Your YouTube-sync screen recording (`marketing/work/youtube-sync.mov`) is the obvious fifth Reel: the
sandbox that recorded these can't reach YouTube, so none of these show sync.
