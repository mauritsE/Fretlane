# Marketing video

> Instagram Reels, carousel, stories, link card and copy for other channels: see [`instagram/`](instagram/README.md).
> Spotify announcement images (square, landscape, story) and post text: see [`social/`](social/README.md).

`fretlane-demo.mp4`: 1920×1080, 96 s, H.264 + AAC, burned-in captions (LinkedIn autoplays muted).
`LINKEDIN_POST.md` holds the post that goes with it.

## What is real
- **Every app screen is a real screen recording** of Fretlane (production build, fresh library),
  driven by `record.ts` with Playwright and captured through Chrome's screencast. The only thing
  added to the page is a visible mouse pointer and click ring, because headless Chrome draws none.
- **The music under "Play along" is the app's own synthesizer**, exported with alphaTab's audio
  export (`export-audio.ts`) and aligned to the moment playback starts in the recording.
- **YouTube sync is Maurits's own screen recording** (`work/youtube-sync.mov`, not in git): Fretlane
  on his Mac with an imported tab of "Animals" (Architects) synced to the song's YouTube video.
  It's cropped to the app window, so the browser's tabs, address bar and profile are not shown.
  That recording has no sound; the video's audio there is narration only.
- **Drawn frames:** the title card, the "Everything you need to practise" card and the end card.
- **Narration:** a local AI voice (Kokoro, voice `am_michael`). To use your own voice, record the
  14 lines from the timeline below and replace the files in `work/tts/`.

## Timeline

| Time | Shot | Line |
| --- | --- | --- |
| 0:00 | Title card | Meet Fretlane: a free, open-source guitar tab player. |
| 0:05 | Library, level filter | Twenty-two well-known songs come built in, from Greensleeves to Beethoven, each tagged by level. |
| 0:12 | Playing a song (app audio) | Open one and the whole band plays, with a cursor that follows every note. |
| 0:21 | Drum and bass tracks (app audio) | Switch to the bass line or the drum part at any time. |
| 0:29 | Half speed | Too fast? Drop it to half speed until your fingers catch up. |
| 0:35 | Metronome | The metronome picks up the song's tempo, at your practice speed. |
| 0:42 | Tap tempo | Or tap in a tempo of your own. |
| 0:48 | Favorites | Star your favorite songs and they jump to the top of your library. |
| 0:55 | Archive | Learned one? Mark it as done, and it moves to your archive. |
| 1:00 | Import dialog | And bring your own tabs: Guitar Pro files, links, or plain text. |
| 1:06 | YouTube sync (your recording) | Link a YouTube video, and the tab follows the recording, bar by bar. |
| 1:16 | Switching tracks during the video | Switch between lead, rhythm and bass while the video keeps playing. |
| 1:25 | Features card | It runs on Mac, Windows and Linux, and keeps everything on your own computer. |
| 1:31 | End card | Fretlane. Free and open source. The link is in the post. |

## Rebuild

```bash
npm run build && FRETLANE_PORT=5183 FRETLANE_LIBRARY=/tmp/fresh-lib npx tsx server/index.ts --serve-dist &
npx tsx marketing/record.ts http://localhost:5183
npx tsx marketing/export-audio.ts http://localhost:5183 "In the Hall of the Mountain King" marketing/work/king.wav
python3 marketing/build.py        # needs ffmpeg, Pillow, kokoro-onnx, soundfile; see the docstring
```

Put the YouTube-sync recording at `marketing/work/youtube-sync.mov` first. `record.ts` writes frames plus `marks.json`; `build.py` turns them into `work/raw.mp4` itself and
caches the narration per line in `work/tts/`. The Kokoro model files go in `marketing/work/`
(download links in `build.py`).
