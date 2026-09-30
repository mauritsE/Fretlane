export type Platform = 'windows' | 'macos' | 'linux';

/** Plain-language instructions shipped next to the executable. No jargon, no terminal commands. */
export function startHereText(platform: Platform, version: string): string {
  const open = {
    windows: `1. Double-click "Songstarr.exe".

   The first time, Windows may show a blue box saying "Windows protected your PC".
   That happens because Songstarr is a free hobby project and is not registered
   with Microsoft. To continue: click "More info", then "Run anyway".
   You only have to do this once.`,
    macos: `1. Double-click "Songstarr".

   The first time, your Mac will probably say it "cannot be opened because the
   developer cannot be verified" (or "Apple could not verify..."). That happens
   because Songstarr is a free hobby project and is not registered with Apple.
   To continue:
     a. Click "Done" (or "Cancel") in that message.
     b. Open System Settings > Privacy & Security.
     c. Scroll down: next to "Songstarr was blocked", click "Open Anyway".
     d. Confirm with your password or Touch ID, then click "Open".
   On older macOS versions you can instead right-click "Songstarr", choose
   "Open", then click "Open" again. You only have to do this once.

   Which download do I need? Macs with an Apple chip (M1, M2, M3, M4...) use the
   "macos-arm64" download. Older Intel Macs use "macos-x64". You can check under
   Apple menu > About This Mac.`,
    linux: `1. Double-click "Songstarr" (if your file manager asks, choose "Run" or
   "Run in Terminal"). You can also start it from a terminal with ./Songstarr`,
  }[platform];

  const quit = {
    windows: 'close the black Songstarr window',
    macos: 'close the Terminal window that opened with Songstarr (or press Control+C in it)',
    linux: 'close the Songstarr window (or press Ctrl+C in it)',
  }[platform];

  const folder = {
    windows: 'C:\\Users\\<your name>\\Songstarr',
    macos: '/Users/<your name>/Songstarr (your home folder)',
    linux: '~/Songstarr (your home folder)',
  }[platform];

  return `SONGSTARR ${version}
Play along with guitar, bass and drum tabs, synced to YouTube videos.
========================================================================

GETTING STARTED
---------------
${open}

2. A small window opens that says "Songstarr is running", and your web browser
   opens Songstarr automatically. If the browser does not open, go to
   http://localhost:5173 yourself.

3. Keep that small window open while you use Songstarr. It is the engine
   that runs the app. The app runs only on your own computer; nothing is
   uploaded anywhere.

To QUIT Songstarr: ${quit}.
To START again later: double-click Songstarr again.


PLAYING A SONG
--------------
- Click a song in your library to open it. Three short demo songs are included
  so you can try it straight away.
- Press the round Play button (or the space bar) to play.
- Use "Speed" to slow a song down while practicing.
- Drag across the tab to select a part, then press "Loop" to repeat it.
- On the left you can switch between instruments (guitar, bass, drums...).


ADDING YOUR OWN SONGS
---------------------
Click "+ Add song" and choose one of:
- Upload file: a tab file from your computer. Guitar Pro files (.gp, .gp3,
  .gp4, .gp5, .gpx), MusicXML files and plain-text tabs all work.
- From URL: a web link that points directly to a tab file.
- Paste text: copy a plain-text tab (the kind with e|---0---3---| lines)
  from anywhere and paste it in.

Optionally paste the YouTube link of the song. Songstarr then plays the video
and moves through the tab along with it.

Only use tabs you made yourself, bought, or are allowed to use.


MAKING THE TAB FOLLOW THE VIDEO
-------------------------------
1. Open the song and click "Sync" (bottom right).
2. In the video, pause exactly on the first beat of the song.
3. Click "Pin to video time". Press Play: the tab now follows the video.
4. Does it drift out of time later in the song? Pause on the first beat of
   the bar where it goes wrong, type that bar number and pin it too.
   Or click "Tap along", play the video, and press T on the first beat of
   every bar.
Plain-text tabs don't contain rhythm, so for those, tap along the whole song.

YouTube videos need an internet connection. Songs without a video play with
Songstarr's built-in instrument sounds and work offline.


WHERE ARE MY SONGS SAVED?
-------------------------
In a folder called "Songstarr" in your home folder:
  ${folder}
To back up your library, copy that folder. To move to a new computer, copy it
to the same place there.


REMOVING SONGSTARR
------------------
Delete the Songstarr program file. If you also want to delete your songs,
delete the "Songstarr" folder in your home folder.


PROBLEMS?
---------
- "Songstarr is already running": it is! Look for the open browser tab, or
  go to http://localhost:5173
- The browser shows "This site can't be reached": Songstarr's window was
  closed. Double-click Songstarr again.
- A YouTube video does not play: some videos are not allowed to be played
  outside of YouTube. Try another upload of the same song.

Songstarr is free, open-source software (MIT licence).
Source code and updates: https://github.com/mauritsE/Songstarr
Licences of included components are in the "licenses" folder.
`;
}
