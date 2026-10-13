# Ko-fi Shop listing

Everything needed to add Fretlane as a digital product in the Ko-fi Shop
(ko-fi.com/mauritselzinga → Shop → Add product → Digital).

| File | Size | Use it as |
| --- | --- | --- |
| `out/1-cover-square.jpg` | 1200×1200 | First (cover) image |
| `out/2-cover-wide.jpg` | 1600×800 | Second image, and a cover if the shop grid crops wide |
| `out/3-library.jpg` | 1600×800 | Gallery image |
| `out/4-player.jpg` | 1600×800 | Gallery image |
| `out/5-metronome.jpg` | 1600×800 | Gallery image |
| `out/6-add-song.jpg` | 1600×800 | Gallery image |
| `out/Fretlane-download-and-install.pdf` | A4, 1 page | The file buyers download |

Rebuild with `python3 marketing/kofi/build.py` (images) and `python3 marketing/kofi/guide.py` (PDF).

## What is real
- Every app screen is one of the real screenshots in `appstore/screenshots/`, scaled down. Nothing in
  them is edited.
- Drawn: the background, headlines and text. Colours and font (Inter) match `marketing/social/`.
- The PDF repeats the steps from `release/RELEASE_NOTES.md`. Its download link points at
  `releases/latest`, so it stays right after a new release. If the install steps change, update both.

## Why the download is a PDF, not the installers
Ko-fi lets you upload files or link to them. The four installers are 115–138 MB each (v0.2.0) and
change with every release. Upload them to Ko-fi and you'd have to re-upload all four each time,
and buyers would get old versions in between. The PDF points at the newest release, so it never
needs updating. If you'd still rather attach the installers, take them from
https://github.com/mauritsE/Fretlane/releases/latest.

## Fields

**Name**
```
Fretlane: tab player that plays along (Windows, Mac, Linux)
```

**Price**: a low minimum (for example €3) with **Pay what you want** switched on, so people can give
more. Ko-fi only applies discount codes at the minimum price.

**Description**
```
Fretlane is a tab player that plays along with the real recording. Open a Guitar Pro file, MusicXML or a plain-text tab, link the song's YouTube video or Spotify track, and the tab scrolls along while you play.

What's in it:
- Guitar Pro (.gp3 to .gp), MusicXML and plain-text tabs
- Plays along with YouTube videos and Spotify tracks. Pin a bar to the recording once and the tab follows it
- Slow YouTube songs down (25–150%) and loop the part you keep missing
- Switch between guitar, bass and drum parts
- A metronome with tap tempo and accents
- 22 songs to start with (Greensleeves, House of the Rising Sun, Für Elise and more), arranged for guitar, bass and drums

Everything runs on your own computer. No account, no subscription, nothing gets uploaded.

Good to know:
- Fretlane is free and open source. You can also download it for free from the website. Buying it here is a way to support the project, and you get a one-page download and install guide.
- Spotify songs play at normal speed only, and may only play 30-second previews in the app. To slow a song down, use a YouTube video of it.
- The app isn't registered with Apple or Microsoft, so your computer asks whether you trust it the first time you open it. The guide shows the one-time click to get past that.
- You bring your own tabs. Fretlane doesn't include anyone else's.

Works on Windows 10/11, macOS (Apple chip and Intel) and Linux.
```

**Message to buyers** (if the form asks for one, or as the first line of the description of the file)
```
Thanks a lot for supporting Fretlane! Open the PDF for the download link and the steps to open the app the first time. Something broken, or an idea? Send me a message here on Ko-fi.
```

## Before you publish
- Check that a €0 or very low price is allowed on your Ko-fi plan, and what fee Ko-fi takes. These
  notes were written without access to Ko-fi's help pages.
- Open the PDF and click every link once.
- Ko-fi suggests 1:1 or 2:1 images. The square cover is the safest first image, because some views
  crop to a square.
