# Spotify social images

Announcement images for Spotify play-along, made the same way as the stills in [`../instagram/`](../instagram/README.md): real screenshots of the app, drawn headline, same colours and font.

| File | Size | For |
| --- | --- | --- |
| `spotify-square-1080.png` | 1080×1080 | LinkedIn, Instagram and Facebook feed posts |
| `spotify-landscape-1200x627.png` | 1200×627 | LinkedIn and X posts, link previews |
| `spotify-story-1080x1920.png` | 1080×1920 | Instagram and LinkedIn stories |

## What is real
- **Every app screen is a real screenshot** of Fretlane (production build, freshly seeded library), taken by `capture.ts`.
- **The Spotify player itself is in none of the shots.** Spotify can't be loaded where these were made. For the same reason, four traditional songs were linked to a placeholder Spotify track id. The id isn't visible anywhere: the "♫ Spotify" badge and the "Sync tab ⇆ track" panel look the same for any Spotify link.
- The two sync pins (bar 1 at 3.42 s, bar 17 at 41.87 s) are example values typed in by `capture.ts`, not taken from a real recording.
- **Drawn:** the headline, the text and the background. The colours and font (Inter) match the demo video.
- No Spotify logo is used, only the name. Spotify's brand rules restrict use of its logo.

## Before you post, check
- **Publish a release that includes Spotify.** The latest download is v0.1.1 (30 September), which has no Spotify support. Release from current `main` first (the `fretlane-release` skill walks through it). Otherwise people who download the app won't find what the post shows.
- **Try Spotify play-along with a real track first.** It has only been tested against a fake Spotify player. Open a song linked to Spotify while logged in to Spotify in your browser, press play, click a bar, and check that the cursor keeps up.
- Spotify songs play at 100% speed only. The images don't promise slowing down, so keep it that way in the post text too.
- The demo video (`../fretlane-demo.mp4`) still mentions only YouTube. Adding a Spotify shot to it needs a screen recording of real Spotify sync, like the YouTube one you recorded on your Mac.

## Post text

**LinkedIn** (post `spotify-square-1080.png` or the landscape image; GitHub link in the first comment, as before):

> Fretlane update: you can now play along with Spotify. 🎸
>
> Paste a Spotify track link next to your tab, pin the first bar to the recording, and the cursor follows the song bar by bar. It works the same as with YouTube videos, which Fretlane already supported.
>
> One honest limitation: Spotify's player can't slow down, so for half-speed practice YouTube is still the better pick.
>
> Free and open source, for Mac, Windows and Linux. Link in the comments. 👇
>
> #guitar #sideproject #opensource #spotify

**Short caption** (X, Instagram, stories):

> Fretlane now plays along with Spotify. Link a track, pin bar 1, and the tab follows the song. Free and open source. 🎸

## Rebuild

```bash
npm run build && FRETLANE_PORT=5183 FRETLANE_LIBRARY=/tmp/fresh-lib npx tsx server/index.ts --serve-dist &
npx tsx marketing/social/capture.ts http://localhost:5183
(mkdir -p marketing/work/fonts-web && cd marketing/work/fonts-web && npm pack @fontsource/inter@5 && tar xzf fontsource-inter-*.tgz)
npx tsx marketing/social/render.ts
```

`capture.ts` removes the placeholder Spotify links, favorites and pins again when it's done.
