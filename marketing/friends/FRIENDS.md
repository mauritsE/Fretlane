# Tell your friends: Facebook post + Instagram story (Fretlane 0.3)

Written in your voice: first person, plain, honest about limits. Change anything that doesn't sound like you.

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

## Facebook post

Upload `fb-1` … `fb-5` as photos. Facebook doesn't hide posts with links in the body the way LinkedIn does, so the link can go in the text.

### English

> If you missed it: for a while now I've been building Fretlane, a guitar tab player. You open a song and the whole band plays along, with the tab following the music. 🎸
>
> I just released a big update, and it does a lot more now:
>
> ✍️ **You can write your own songs in it.** Type the fret numbers and you hear every note as you type. Guitar, bass, ukulele, mandolin, banjo, and drums.
> 🥁 Drums mattered to me in particular. I've been a drummer since I was 12, and I wrote most of my band songs in Guitar Pro with a guitar on my lap. This is the tool I wanted back then.
> 🤖 **There's a riff assistant.** Select a few bars and ask for "heavier", or ask for a bass line and drums that fit what you wrote. It reads the whole song first. It doesn't always nail it, but "Try again" and undo are right there.
> 🎧 **Play along with your own recordings:** an old rehearsal take, a backing track, any MP3 or WAV. Slow it down without the pitch changing, and the tab stays in sync.
> ⤓ Everything exports to Guitar Pro.
> 🍏 The Mac version is now signed by Apple, so you no longer have to click "Open Anyway".
>
> Playing along stays free, and you don't need an account. Writing songs and the assistant come with Fretlane Cloud, from $5 a month. That also pays for the AI behind it.
>
> I'd really appreciate it if you tried it, or passed it on to that one friend who's always playing guitar at parties. And tell me what's broken. Honestly, that helps me most.
>
> 👉 fretlane.app

### Nederlands

> Voor wie het gemist heeft: ik ben al een tijdje bezig met Fretlane, een tab-speler voor gitaar. Je opent een nummer, de hele band speelt mee en de tab loopt mee met de muziek. 🎸
>
> Er is net een flinke update uit, en hij kan nu een stuk meer:
>
> ✍️ **Je kunt er je eigen nummers in schrijven.** Typ de fretnummers en je hoort elke noot meteen. Gitaar, bas, ukelele, mandoline, banjo, en drums.
> 🥁 Die drums waren voor mij belangrijk. Ik drum sinds mijn twaalfde, en schreef de nummers voor mijn bands in Guitar Pro met een gitaar op schoot. Dit is de tool die ik toen had willen hebben.
> 🤖 **Er zit een riff-assistent in.** Selecteer een paar maten en vraag om "zwaarder", of vraag om een baslijn en drums die passen bij wat je al hebt. Hij leest eerst het hele nummer. Het is niet altijd raak, maar "Try again" en ongedaan maken zitten er gewoon in.
> 🎧 **Speel mee met je eigen opnames:** een oude repetitie-opname, een backing track, elke MP3 of WAV. Langzamer afspelen zonder dat de toonhoogte verandert, en de tab blijft synchroon.
> ⤓ Alles kun je exporteren naar Guitar Pro.
> 🍏 De Mac-versie is nu ondertekend door Apple, dus geen "Toch openen" meer.
>
> Meespelen blijft gratis, zonder account. Nummers schrijven en de assistent zitten in Fretlane Cloud, vanaf $5 per maand. Daarmee betaal ik ook de AI erachter.
>
> Ik zou het heel tof vinden als je het probeert, of het doorstuurt naar die ene vriend die op elk feestje de gitaar pakt. En laat me weten wat er stuk is. Eerlijk gezegd heb ik daar het meeste aan.
>
> 👉 fretlane.app

### Short version (for a comment, WhatsApp, or a repost)

> My tab player Fretlane writes songs now: type the frets, add drums and bass, and ask the riff assistant for a part when you're stuck. Playing along with your own recordings works too. Free to play along, writing from $5/month. fretlane.app 🎸

## Instagram story

Post the six frames in order. The text on the images is in English; the stickers can be in whatever language your followers use.

| Frame | On the image | Add in Instagram |
| --- | --- | --- |
| `story-1` | "Remember that tab player I built?" | Nothing, or a short clip of you playing a riff as the background audio |
| `story-2` | "Now it writes songs" (editor, guitar track) | Nothing |
| `story-3` | "With drums too" (drum track) | **Poll** in the empty space at the bottom: "Do you play? 🎸" → "Yes" / "I used to" |
| `story-4` | "And an AI that writes the bass line" | **Question** sticker: "What should it write next?" |
| `story-5` | "Your band's rehearsal, synced to the tab" | Nothing |
| `story-6` | "Free download at fretlane.app" | **Link** sticker → `https://fretlane.app` where it says "Link sticker goes here ↓" |

The poll and question stickers matter more than they seem: replies come in as DMs, so you get to talk to the people who play.

## Before you post, check
- **Open `fretlane.app` on your phone.** The story's link sticker sends people there, and most of them will be on a phone. The desktop app doesn't run on phones, so check that the page explains that and offers the online player or `/try`.
- **"Mac version is now signed by Apple"**: true from v0.3.3 (released 20 October). If anyone still gets a warning, they downloaded an older version.
- **Pricing**: the post says "from $5 a month", which matches the site today ($5 / $25 / $50 for 96 / 480 / 1,152 assistant bars). Update both texts if that changes.
- **The drummer and Guitar Pro lines** come from what you've told me about yourself. Cut them if they feel too personal for Facebook.
- **Want a real AI answer in the visuals?** Ask the assistant something in your own app, take a screenshot when the new bars are in, and send it to me. I'll swap it into `story-4` / `fb-3`. Keep the first answer, even if it's not perfect.

## Rebuild

```bash
npm run build
npx tsx marketing/friends/capture.ts      # real editor screenshots -> marketing/work/friends/
python3 marketing/friends/render.py       # -> marketing/friends/out/
```

`render.py` needs Pillow and Inter as OTF in `/usr/share/fonts/opentype/inter/` (`fonts-inter` on Debian/Ubuntu).
