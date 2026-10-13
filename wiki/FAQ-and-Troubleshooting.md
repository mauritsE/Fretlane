# FAQ and troubleshooting

## General

### Is Fretlane free?

Yes. The source code and the downloads on the [Releases page](https://github.com/mauritsE/Fretlane/releases) are free. The Mac App Store version costs a few euros: it's the same app, signed by Apple so it installs and updates in one click, and buying it supports development.

### Do I need an account or an internet connection?

No account. The bundled songs and your own tabs play offline with the built-in synthesizer. You need an internet connection only for YouTube or Spotify recordings, the **🔍 Find** search, and importing a tab from a URL.

### Does Fretlane collect my data?

No. See the [Privacy policy](Privacy-Policy).

### Where does Fretlane get tabs?

From you. Fretlane comes with original demo tabs and 22 public-domain songs, and you add your own tabs. It doesn't scrape tab sites. See [Copyright and tabs](Copyright-and-Tabs).

### Which file formats can I open?

Guitar Pro 3–8 (`.gp3`, `.gp4`, `.gp5`, `.gpx`, `.gp`), MusicXML (`.xml`, `.musicxml`, `.mxl`), alphaTex (`.atex`) and plain-text ASCII tabs. Files up to 20 MB.

### Is there an iPhone, iPad or Android version?

Not yet. Fretlane runs on Windows, macOS and Linux.

### Does Apple Music work?

No. Controlling Apple Music from an app needs a paid Apple developer token. Use YouTube or Spotify.

## Installing and opening

### macOS says Fretlane "can't be opened" or "can't verify the developer"

The GitHub download isn't registered with Apple. Open it once with **System Settings → Privacy & Security → Open Anyway**. See [Installation](Installation#opening-it-the-first-time). The Mac App Store version doesn't show this warning.

### Windows says "Windows protected your PC"

Click **More info** → **Run anyway**. You only need to do this once.

### The Linux AppImage doesn't start

Make it executable (right-click → Properties → allow executing as a program, or `chmod +x Fretlane-*.AppImage`). On some distributions AppImages also need FUSE (`libfuse2`).

### Where are my songs? How do I back them up?

In the **Fretlane** folder in your home folder (**File → Show Songs Folder**). Copy that folder to back up your library or move it to another computer.

### I updated and my songs are gone

Updates keep your library. Check **File → Show Songs Folder**. If you came from Songstarr, your old `Songstarr` folder is moved to `Fretlane` on first start; if it was on another drive or locked, Fretlane keeps using the old folder.

### I deleted a bundled song and want it back

Bundled songs you delete stay deleted: `seeded.json` in your songs folder remembers which ones were already added. To get one back, quit Fretlane, open `seeded.json` in a text editor, remove the line with that song's file name (mind the commas), save, and start Fretlane again.

## Playing and syncing

### There's no sound

- Check your computer's volume and output device.
- Check that the track isn't muted, and that another track isn't soloed.
- With YouTube or Spotify, the sound comes from the recording; check its own volume control in the video or player.

### The cursor runs ahead of or behind the video

Open **⇆ Sync**, pause the video exactly on the first beat of bar 1 and click **📌 Pin to video time**. If the band changes speed, pin more bars or use **Tap along**. Use **Shift all** for small corrections. See [Getting started](Getting-Started#sync-the-tab-to-the-recording).

### A plain-text tab plays with the wrong rhythm

Text tabs contain no rhythm, so every note column becomes an eighth note. Pin every bar so the cursor stays on the right bar, or use a Guitar Pro or MusicXML version of the tab.

### A file won't open

The file may be damaged, be in an unsupported format, or the URL may point to a web page instead of the file. Try downloading the file and using **Upload file**. If it still fails, [report it](Support) with the file if you may share it.

### Importing from a URL fails

Some sites block downloads by apps or need you to be logged in. Download the file in your browser and use **Upload file** instead.

## YouTube and Spotify

### A YouTube video won't play

Some videos can't be played in embedded players (the uploader turned this off) or are blocked in your country. Pick another upload of the same recording with **🔍 Find**.

### YouTube search in 🔍 Find stopped working

It uses YouTube's own unofficial search, which can break when YouTube changes it. The dialog then shows a link to the same search on youtube.com: copy the video link from there and paste it in. A new Fretlane version usually fixes it.

### How do I set up Spotify search?

Click **🔍 Find**, choose Spotify, and follow the steps in the dialog: create a free app at <https://developer.spotify.com/dashboard>, then paste its Client ID and Client secret. They're stored only in `settings.json` in your songs folder.

### Spotify plays only 30 seconds

Spotify plays full tracks only when you're logged in to Spotify in the same browser. In the desktop app expect previews only. Use a YouTube video of the song to practise the whole thing.

### Why can't I slow down a Spotify song?

Spotify's player doesn't support changing speed. Use a YouTube video of the song to practise slower.

### Can a song have both a YouTube video and a Spotify track?

No. Sync pins belong to one specific recording, so a song has one or the other.

## Still stuck?

See [Support](Support).
