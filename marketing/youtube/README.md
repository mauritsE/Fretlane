# YouTube videos

Ready-to-upload files are in `out/`. Titles, descriptions, chapters, tags and the posting order are in
[`YOUTUBE.md`](YOUTUBE.md).

- `fretlane-walkthrough.mp4`: 3:26 narrated tour with 9 chapters, captions as `.srt`.
- `fretlane-trailer.mp4`: the 96 s LinkedIn demo with a YouTube end card ("link in the description").
- `thumbnail-*.jpg`: 1280×720, built from real frames of the recording.

## How it's made
- `record.ts` drives the real app (production build, fresh library) with Playwright on a 1536×864
  viewport at 1.25× (1920×1080 frames, with the UI a bit larger than in the LinkedIn video). Like the
  Instagram take, it records the app's own audio from the page. It fails unless the loop actually
  repeats.
- `build.py` cuts the take into shots (one narration line each, see `SHOTS`), frames the footage,
  adds the drawn cards, mixes the narration over the app's sound (ducked), and writes the `.srt` and
  `chapters.txt`. It refuses to speed up a shot that has audible app sound, and fails if a line is
  longer than its real-time footage.
- The YouTube-sync shots are cut out of `../fretlane-demo.mp4`, which holds Maurits's own recording.
  `--no-sync-footage` leaves them out (see the Content ID note in `YOUTUBE.md`).

## Rebuild

```bash
npm run build
FRETLANE_PORT=5183 FRETLANE_LIBRARY=/tmp/fresh-lib npx tsx server/index.ts --serve-dist &
npx tsx marketing/youtube/record.ts http://localhost:5183
python3 marketing/youtube/build.py                  # or: walkthrough / trailer, --preview, --no-sync-footage
```

Needs ffmpeg, Pillow, kokoro-onnx + soundfile, the Kokoro model files in `marketing/work/`, and Inter
as TTF in `marketing/work/fonts/` (see `../README.md` and `../instagram/README.md`). The library must
be fresh: the take stars, archives and adds a song. Narration is cached per line in
`marketing/work/tts/`, so changing one line only re-voices that line.
