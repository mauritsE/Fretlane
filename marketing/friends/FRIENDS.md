# Tell your friends: Facebook post + Instagram story (Fretlane 0.3)

The copy follows the style of your own sent mail (see *Your voice*). Change anything that still doesn't sound like you.

| File | For |
| --- | --- |
| `out/fb-1.jpg` … `fb-5.jpg` (1080×1350) | Facebook post, uploaded as photos in this order. Also works as an Instagram feed carousel |
| `out/story-1.jpg` … `story-6.jpg` (1080×1920) | Instagram story (works for Facebook stories too) |

## What is real
- **Every app screen is a real screenshot of Fretlane 0.3.3**, nothing is mocked up:
  - The editor shots (`fb-1`, `fb-2`, `fb-3`, `story-2`, `story-3`, `story-4`) come from `capture.ts`, which opens an original 8-bar riff, "Trail Run", in the editor. I wrote the riff for these images: palm-muted chugs in E minor with a bass line and a rock beat.
  - The audio-file shots (`fb-4`, `story-5`) and the Cloud dialog come from the App Store screenshot set (`appstore/screenshots/`).
- **Staged:** the app is signed in to a *fake* Fretlane Cloud account (writer@example.com, $5 plan, "0 of 96 bars used"), the same way the e2e test does it. That's why the riff assistant box is unlocked.
- **The riff assistant was not used.** The prompt "A bass line and drums that follow this riff" is typed into the box, but never sent. No AI answer is shown anywhere, because I can't reach Claude from here without your key. If you want to show a real answer, take a screenshot of one in your own signed-in app (see the checklist).
- **Drawn:** the headlines, the backgrounds and the end card. Same colours and font (Inter) as the earlier Instagram kit.

## Your voice
Taken from your own sent mail (only the style; nothing from it is quoted or stored here):
- Short. Say the point in the first sentence, then stop.
- Plain facts and numbers, few adjectives, no hype words.
- Ask directly: "Could you…?", "Would be great if…".
- Warm but brief: "Top.", "Thanks!", an occasional ":)". No emoji.
- No backstory or feelings you didn't state yourself.

## Facebook post

Upload `fb-1` … `fb-5` as photos. Facebook doesn't hide posts with a link in the text, so it can go in the post.

> For a while now I've been building Fretlane, a guitar tab player. You open a song, the band plays along and the tab follows the music.
>
> Version 0.3 is out and it does a lot more now:
> - Write your own songs: guitar, bass and drums (ukulele, mandolin and banjo too)
> - A riff assistant that writes a bass line or drums that fit your riff
> - Play along with your own recordings, and slow them down if you want
> - Export everything to Guitar Pro
>
> Playing along is free. Writing songs and the assistant are part of Fretlane Cloud, $5 a month.
>
> Would be great if you try it, or send it to someone who plays guitar. And if something doesn't work, let me know :)
>
> fretlane.app

### Short version (comment, WhatsApp, repost)

> Fretlane 0.3 is out. You can now write your own songs in it, with guitar, bass and drums, and a riff assistant for when you're stuck. Playing along is free: fretlane.app

## Instagram

This is your first post about Fretlane on Instagram, so it introduces Fretlane instead of announcing an update. Post the feed post and the story on the same day: the story sends people to the link, the post stays on your profile.

### Feed post

Upload `fb-1` … `fb-5` as one carousel post. Instagram doesn't make links in captions clickable, so put `https://fretlane.app` in your bio (Edit profile → Links) for as long as you're promoting it.

> I built a guitar tab player: Fretlane. You open a song, the band plays along and the tab follows the music.
>
> You can also write your own songs in it, with guitar, bass and drums, and a riff assistant that writes a part that fits. And you can play along with your own recordings.
>
> Playing along is free. Link in bio. If something doesn't work, let me know :)
>
> #guitar #guitartabs #songwriting

### Story

Post the six frames in order.

| Frame | On the image | Add in Instagram |
| --- | --- | --- |
| `story-1` | "I built a guitar tab player" | Nothing, or a short clip of you playing a riff as the background audio |
| `story-2` | "And you can write songs in it" (editor, guitar track) | Nothing |
| `story-3` | "With drums too" (drum track) | **Poll** in the empty space at the bottom: "Do you play guitar?" → "Yes" / "I used to" |
| `story-4` | "And an AI that writes the bass line" | **Question** sticker: "What should it write next?" |
| `story-5` | "Your band's rehearsal, synced to the tab" | Nothing |
| `story-6` | "Free download at fretlane.app" | **Link** sticker → `https://fretlane.app` where it says "Link sticker goes here ↓" |

The poll and question stickers matter more than they seem: replies come in as DMs, so you get to talk to the people who play.

## Before you post, check
- **Open `fretlane.app` on your phone.** The story's link sticker sends people there, and most of them will be on a phone. The desktop app doesn't run on phones, so check that the page explains that and offers the online player or `/try`.
- **"Mac version is now signed by Apple"**: true from v0.3.3 (released 20 October). If anyone still gets a warning, they downloaded an older version.
- **Pricing**: the post says "from $5 a month", which matches the site today ($5 / $25 / $50 for 96 / 480 / 1,152 assistant bars). Update both texts if that changes.
- **Want a real AI answer in the visuals?** Ask the assistant something in your own app, take a screenshot when the new bars are in, and send it to me. I'll swap it into `story-4` / `fb-3`. Keep the first answer, even if it's not perfect.

## Rebuild

```bash
npm run build
npx tsx marketing/friends/capture.ts      # real editor screenshots -> marketing/work/friends/
python3 marketing/friends/render.py       # -> marketing/friends/out/
```

`render.py` needs Pillow and Inter as OTF in `/usr/share/fonts/opentype/inter/` (`fonts-inter` on Debian/Ubuntu).
