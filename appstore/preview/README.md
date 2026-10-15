# Mac App Store preview video

`fretlane-preview.mp4` is the App Preview for App Store Connect: 28 s, 1920×1080, 30 fps,
H.264 High@4.0 at about 11 Mbps CBR, stereo AAC at 48 kHz. That is within Apple's macOS app
preview spec (15–30 s, 1920×1080, at most 30 fps, H.264 at 10–12 Mbps, stereo 256 kbps AAC).

What it shows, all of it filmed from the real app in one take: the library → Drunken Sailor with the
whole band → switching to the bass → a two-bar loop at half speed → House of the Rising Sun playing
along with an audio file, with its waveform in the sync panel → pasting a plain-text tab and
hearing it play. The audio file is the song rendered by Fretlane's own synthesizer, so it is ours. The sound is the app's own playback. The captions are plain text, because the
store plays previews muted until someone turns the sound on.

Apple's preview rules that shaped it: in-app footage only (no hands, no device frames), only
content you have the rights to (so no YouTube or Spotify footage, just public-domain songbook songs
and an original riff), simple fades between shots, and no prices or dates in the text.

## Rebuild

```bash
npm run build
npx tsx appstore/preview/record.ts
python3 appstore/preview/build.py --sheet   # optional: contact sheet of the raw take
python3 appstore/preview/build.py
```

`record.ts` starts its own Fretlane on a fresh library (`appstore/demo-env.ts`), because the take
adds a song and an audio file. It also routes `<audio>` elements through Web Audio so the
play-along file is recorded. It fails if the loop doesn't
actually repeat. `build.py` cuts the shots listed in `SHOTS` (each one relative to a mark the
recorder set) and refuses to write a video outside 15–30 s. It needs ffmpeg, Pillow and the Inter
font (`/usr/share/fonts/opentype/inter/`).
