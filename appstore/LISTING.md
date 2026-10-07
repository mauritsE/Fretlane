# Mac App Store listing: copy-paste sheet

Every field App Store Connect asks for, in the order you meet them. Each value sits in its own code
block, so you can copy it with one click on GitHub. Character limits are Apple's, and every text
below fits them (`node appstore/check-lengths.mjs` checks this).

Fields marked **YOU** need your own details. They are left out on purpose because this file is public.

---

## 1. New App dialog (My Apps → + → New App)

| Field | Value |
| --- | --- |
| Platforms | macOS |
| Name | see below |
| Primary language | English (U.K.) |
| Bundle ID | `app.fretlane` (register it first, see `SUBMITTING.md` step 2) |
| SKU | see below |
| User access | Full Access |

**Name** (30)
```
Fretlane
```
If Apple says the name is taken, use:
```
Fretlane Tab Player
```

**SKU** (internal, never shown)
```
fretlane
```

---

## 2. App Information (left sidebar → General → App Information)

**Subtitle** (30)
```
Guitar tabs that play along
```

**Category**: Primary **Music**, Secondary **Education**.

**Content Rights.** Question: *Does your app contain, show, or access third-party content?*
Answer **Yes**, then tick *I have the necessary rights*. Reason: the app shows YouTube videos and
Spotify tracks that the user links, through YouTube's and Spotify's official embedded players, and
it bundles alphaTab (MPL-2.0) and the Bravura music font (OFL). The bundled songs are public-domain
melodies in our own arrangements.

**Age Rating** (Edit → questionnaire). Answer every item **None** / **No**:

| Section | Item | Answer |
| --- | --- | --- |
| In-App Controls | Parental Controls | No |
| In-App Controls | Age Assurance | No |
| Capabilities | Unrestricted Web Access | No (no browser; outside links open in the user's own browser) |
| Capabilities | User-Generated Content | No (imported tabs stay on the user's Mac, nothing is shared) |
| Capabilities | Social Media / Messaging and Chat / Advertising | No |
| Mature Themes | Profanity, Horror/Fear, Alcohol/Tobacco/Drugs | None |
| Medical or Wellness | both items | None |
| Sexuality or Nudity | all items | None |
| Violence | all items | None |
| Chance-Based Activities | Gambling, Simulated Gambling, Contests, Loot Boxes | None / No |

Result: **4+**. *Made for Kids*: leave unticked.

**License Agreement**: keep Apple's standard EULA.

---

## 3. Pricing and Availability

| Field | Value |
| --- | --- |
| Name (30) | Fretlane |
| Subtitle (30) | Guitar tabs that play along |
| Primary category | Music |
| Secondary category | Education |
| Age rating | 4+ (no objectionable content; the app can show YouTube videos the user links, see "Web access" below) |
| Price | €4.99, one-time (base country Netherlands; see step 6 of `SUBMITTING.md`). The source and GitHub downloads stay free. |
| Copyright | 2026 Maurits Elzinga |
| Support URL | https://github.com/mauritsE/Fretlane/wiki/Support |
| Marketing URL | https://github.com/mauritsE/Fretlane |
| Privacy Policy URL | https://github.com/mauritsE/Fretlane/wiki/Privacy-Policy |
| Base country | Netherlands |
| Price | €4.99 (Apple fills in other countries) |
| Availability | All countries or regions |
| Pre-orders | Off |
| Distribute to Apple silicon and Intel Macs | Yes (the build is universal) |

The source code and GitHub downloads stay free. `SUBMITTING.md` step 6 covers the Paid Apps
agreement, tax and banking, and the Small Business Program.

---

## 4. App Privacy

**Privacy Policy URL**
```
https://github.com/mauritsE/Fretlane/blob/main/appstore/PRIVACY.md
```

**User Privacy Choices URL**: leave empty (nothing to opt out of).

**Data collection.** *Do you or your third-party partners collect data from this app?* →
**No, we do not collect data from this app.** The label then reads **Data Not Collected**.

Why that's true: no analytics, no crash reporter, no account, no ads, no server of our own. The
library is a folder inside the app's sandbox. YouTube and Spotify players load only for songs the
user linked to a video or track, and their own privacy policies cover them (PRIVACY.md says so).

---

## 5. Version page (macOS App → 0.2.0 Prepare for Submission)

The version number must match the build. It is `version` in package.json, currently:
```
0.2.0
```

**Promotional Text** (170, can be changed any time without review)
```
22 well-known songs ready to play: Greensleeves, Für Elise, House of the Rising Sun and more. Slow down, loop, and play along with YouTube or Spotify.
```

**Description** (4000)
```
Fretlane is a tab player for guitarists who want to practise songs, not fight software.

Open a song and it plays: a cursor follows the tab while the built-in band plays melody, rhythm guitar, bass and drums. Slow it down to 25% to learn a hard passage, loop a few bars, and speed it back up when you've got it.

READY TO PLAY
• 22 well-known songs included, arranged for guitar with bass and drums: Greensleeves, House of the Rising Sun, Scarborough Fair, Für Elise, Canon in D, Romanza, Moonlight Sonata, In the Hall of the Mountain King, When the Saints Go Marching In, Drunken Sailor and more.
• From first chords to fingerstyle: every song is marked beginner or intermediate.

PRACTISE BETTER
• Metronome with tap tempo, accents and subdivisions. One click sets it to the song's tempo.
• Speed control, looping, count-in and a click track that follows the tab.
• Solo or mute any instrument.
• Tab, standard notation, or both.

PLAY ALONG WITH THE REAL RECORDING
• Link a YouTube video or a Spotify track to any song.
• Pin the first beat once, and the tab cursor follows the recording.
• YouTube videos can be slowed down too. Spotify plays at normal speed, and plays full tracks when you're logged in to Spotify (otherwise 30-second previews).

YOUR OWN SONGS
• Import Guitar Pro files (.gp, .gp5, .gpx and more), MusicXML, alphaTex, or plain-text tabs: pick a file, paste a link, or paste the tab itself.
• Search by title, artist or tag.
• Star your favorites, and move songs you've learned to the archive.

PRIVATE BY DESIGN
Your library stays on your Mac. No account, no tracking, no ads.

Fretlane is open source (MIT). The included songs are public-domain melodies in original arrangements. Buying it on the App Store gets you a signed app that installs and updates in one click, and supports its development.
```

**Keywords** (100 bytes, comma separated, no spaces). No brand names: Apple rejects other
companies' trademarks here.
```
guitar,tabs,tablature,bass,drums,practice,metronome,chords,songbook,learn,lessons,fingerstyle,riffs
```

**Support URL**
```
https://github.com/mauritsE/Fretlane/issues
```

**Marketing URL**
```
https://github.com/mauritsE/Fretlane
```

**Copyright**
```
2026 Maurits Elzinga
```

**What's New in This Version** (not shown for a first version, but harmless to fill in)
```
First release on the Mac App Store.
```

**Routing App Coverage File**: not applicable (Mac).

**Game Center**: off.

---

## 6. Screenshots (Mac, 16:10)

Upload in this order. All are 2880×1800, Apple's largest Mac size; App Store Connect scales them
down for other sizes. Apple allows up to 10.

| # | File | Shows |
| --- | --- | --- |
| 1 | `appstore/screenshots/1-library.png` | The library with favorites and tags |
| 2 | `appstore/screenshots/2-player.png` | A multi-track song playing, cursor and mixer |
| 3 | `appstore/screenshots/3-metronome.png` | The metronome set to the song's tempo |
| 4 | `appstore/screenshots/5-notation.png` | Standard notation above the tab (Score + Tab) |
| 5 | `appstore/screenshots/6-add-song.png` | Importing your own tab by pasting it |
| 6 | `appstore/screenshots/4-archive.png` | The archive of finished songs |

Regenerate them from a running app: `npx tsx scripts/appstore-screenshots.ts http://localhost:5173`.

**App Preview video**: optional, skip it. The existing marketing videos are 96 s and longer;
Apple's limit is 30 s.

**App icon**: nothing to upload. On the Mac it comes from the build (`build/icon.png`).

---

## 7. Build

Pick the build uploaded by the **Mac App Store** GitHub workflow (`SUBMITTING.md` step 9).

**Export compliance** (asked when you pick the build). Fretlane only uses standard HTTPS, to load
YouTube/Spotify players and to download a tab from a link the user enters. It has no encryption of
its own. Answer so it lands on *exempt / no documentation needed*:

- *Does your app use encryption?* → **Yes** (Apple asks you to say Yes even for HTTPS only).
- *Does your app qualify for any of the exemptions?* → **Yes**: it only uses standard encryption
  (HTTPS/TLS) for normal network connections.
- If the dialog instead asks *What type of encryption algorithms does your app implement?*, choose
  **None of the algorithms mentioned above**.

---

## 8. App Review Information

**Sign-in required**: untick it (no account in the app).

**Contact information** (**YOU**): first name, last name, phone number with country code
(e.g. `+31 6 …`), email address. Apple only uses these to reach you about the review.

**Notes** (4000 bytes)
```
Fretlane is a guitar tab player. No login or account is needed.

How to test:
1. Click any song in the library, e.g. "Greensleeves".
2. Press Play (or Space). The built-in synthesizer plays the song and the cursor follows the tab. Change Speed to 50% to hear it slowed down.
3. Press M to open the metronome and click "Use song tempo".
4. Go back to the library. The ☆ on a song card adds it to Favorites, ✓ moves it to the Archive (see the tabs at the top).
5. "+ Add song" → "Paste text" accepts a plain-text guitar tab; "Upload file" accepts Guitar Pro and MusicXML files.

Optional features: a song can be linked to a YouTube video or a Spotify track. These play in YouTube's and Spotify's official embedded players. Spotify plays 30-second previews unless the user is logged in to Spotify; Fretlane never sees Spotify credentials.

About the entitlements: the app runs a small web server bound to 127.0.0.1 inside its own process, which serves the user interface and the song library to the app window. It is not reachable from other computers (com.apple.security.network.server). Network client access loads the YouTube/Spotify players and downloads a tab from a link the user enters. File access is read-only and limited to files the user picks in the Open dialog. The library is stored inside the app's sandbox container.

The 22 bundled songs are public-domain melodies (traditional songs and composers who died long ago) in our own arrangements. Fretlane bundles no third-party tabs. The app is open source: https://github.com/mauritsE/Fretlane
```

**Attachment**: none needed.

---

## 9. Version release

Choose **Manually release this version**, so you decide the moment it goes live after approval.

---

## 10. Business and legal (once per account)

Choose **Data Not Collected**. Fretlane has no analytics, no account and no server of its own. Note for the questionnaire: when a user links a YouTube video, the video plays in YouTube's own embedded player, which is covered by Google's privacy policy, and Spotify tracks play in Spotify's embedded player (both mentioned in the [privacy policy](../wiki/Privacy-Policy.md)).
