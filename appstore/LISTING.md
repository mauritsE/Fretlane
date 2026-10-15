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
| Capabilities | User-Generated Content | No (imported tabs stay on the user's Mac; Fretlane Cloud only shows the user's own tabs, nothing is shared with others) |
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
https://github.com/mauritsE/Fretlane/wiki/Privacy-Policy
```

The wiki page is published from `wiki/Privacy-Policy.md` by `.github/workflows/wiki.yml`. Check it
opens before you submit.

**User Privacy Choices URL**: leave empty (nothing to opt out of).

**Data collection.** Since 0.3.0 the app can sign in to **Fretlane Cloud**, your own service, so
the answer is no longer "Data Not Collected". *Do you or your third-party partners collect data from
this app?* → **Yes, we collect data from this app.** Then tick exactly these types:

| Data type | Linked to the user? | Used for tracking? | Purpose |
| --- | --- | --- | --- |
| Contact Info → **Email Address** | Yes | No | App Functionality |
| Identifiers → **User ID** | Yes | No | App Functionality |

The label then reads **Data Linked to You: Contact Info, Identifiers**.

Why these two: when someone signs in, the app receives their account's email address (shown as
"Signed in as …") and sends a sign-in token tied to their account with every Cloud request. That is
the honest minimum. Not ticked, on purpose:

- *User Content*: the app only downloads the user's own cloud tabs; it never uploads anything.
- *Usage Data, Diagnostics*: no analytics, no crash reporter, no ads.
- YouTube and Spotify: they load only for songs the user linked, through their official players, and
  their own privacy policies cover them (the privacy policy says so). Apple doesn't count those as
  your collection.

Fretlane Cloud is off until someone clicks **☁ Cloud** and signs in. Without it the app still
collects nothing. `wiki/Privacy-Policy.md` already describes Cloud.

---

## 5. Version page (macOS App → 0.3.0 Prepare for Submission)

The version number must match the build. It is `version` in package.json, currently:
```
0.3.0
```
0.2.0 was the first submission. Every new submission needs a higher number, so this one is a
**new version** (App Store Connect → macOS App → **+** next to the version list → 0.3.0).

**Promotional Text** (170, can be changed any time without review)
```
22 well-known songs ready to play. Slow down, loop, and play along with your own MP3s, YouTube or Spotify, with the tab cursor following the recording.
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
• Or play along with your own audio file: MP3, WAV, FLAC, OGG or M4A, for example a recording of your band.
• A waveform of your audio file helps you place the first beat: click the note and it snaps to the attack.
• Audio files and YouTube videos can be slowed down too, without changing the pitch. Spotify plays at normal speed, and plays full tracks when you're logged in to Spotify (otherwise 30-second previews).

YOUR OWN SONGS
• Import Guitar Pro files (.gp, .gp5, .gpx and more), MusicXML, alphaTex, or plain-text tabs: pick a file, paste a link, or paste the tab itself.
• Search by title, artist or tag.
• Star your favorites, and move songs you've learned to the archive.
• Have a Fretlane Cloud account? Open the tabs you stored there, with their YouTube or Spotify link and sync already set.

PRIVATE BY DESIGN
Your library stays on your Mac. No account needed, no tracking, no ads.

Fretlane is open source (MIT). The included songs are public-domain melodies in original arrangements. Buying it on the App Store gets you a signed app that installs and updates in one click, and supports its development.
```

**Keywords** (100 bytes, comma separated, no spaces). No brand names: Apple rejects other
companies' trademarks here.
```
guitar,tabs,tablature,bass,drums,practice,metronome,chords,songbook,learn,lessons,fingerstyle,riffs
```

**Support URL**
```
https://github.com/mauritsE/Fretlane/wiki/Support
```

**Marketing URL**
```
https://github.com/mauritsE/Fretlane
```

**Copyright**
```
2026 Maurits Elzinga
```

**What's New in This Version**
```
• Play along with your own audio files: MP3, WAV, FLAC, OGG and M4A.
• Waveform in the sync panel: click the first beat and it snaps to the note.
• Slow down your audio file without changing the pitch.
• Fretlane Cloud: open the tabs stored in your Fretlane Cloud account.
```

**Routing App Coverage File**: not applicable (Mac).

**Game Center**: off.

---

## 6. Screenshots (Mac, 16:10)

Upload in this order. All are 2880×1800, Apple's largest Mac size; App Store Connect scales them
down for other sizes. Apple allows up to 10. Delete the 0.2.0 screenshots first if App Store
Connect copied them into the new version.

| # | File | Shows |
| --- | --- | --- |
| 1 | `appstore/screenshots/2-player.png` | A multi-track song playing, cursor and mixer |
| 2 | `appstore/screenshots/7-audio-file.png` | Playing along with an audio file, waveform and sync pin |
| 3 | `appstore/screenshots/1-library.png` | The library with favorites, tags and an audio badge |
| 4 | `appstore/screenshots/3-metronome.png` | The metronome set to the song's tempo |
| 5 | `appstore/screenshots/5-notation.png` | Standard notation above the tab (Score + Tab) |
| 6 | `appstore/screenshots/6-add-song.png` | Importing your own tab by pasting it |
| 7 | `appstore/screenshots/8-cloud.png` | Fretlane Cloud: the tabs in your account |
| 8 | `appstore/screenshots/4-archive.png` | The archive of finished songs |

All of them are the real app (`npm run build`, then `npx tsx scripts/appstore-screenshots.ts`),
on a fresh library so your own songs never appear. Two things in them are staged, and that is
allowed because they show real features:

- The audio file in screenshot 2 is *House of the Rising Sun* rendered by Fretlane's own
  synthesizer, with a second of silence in front, so no one else's recording appears.
- Screenshot 7 talks to a stand-in for Fretlane Cloud (`appstore/demo-env.ts`) with a demo account
  (`you@example.com`) that holds the app's own original and public-domain tabs. The window, its
  buttons and the import are the real app.

**App Preview video** (optional): `appstore/preview/fretlane-preview.mp4`, 28 s, 1920×1080, real
app footage with the app's own sound and short captions. Drag it into the App Previews slot above
the screenshots, replacing the 0.2.0 one. It shows the band playing, switching instrument, a loop at
half speed, playing along with an audio file with its waveform, and pasting a tab. Only bundled
public-domain songs, an original riff and the app's own synthesizer are heard; no YouTube or
Spotify footage (Apple only allows content you have the rights to). How it's made:
`appstore/preview/README.md`.

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

**Sign-in required**: **tick it** and enter a Fretlane Cloud demo account (**YOU**, see below).
The app works without an account, but Apple wants to try every feature, and the ☁ Cloud window
needs one. Without working credentials they reject with Guideline 2.1 (information needed).

The demo account must work for a reviewer who is not you, on a computer you don't control:

- **User name / Password**: an account on the Fretlane website that signs in with an email and
  password (or another method a stranger can use). A Google-only sign-in does not work for
  reviewers: they can't get past Google's two-step check on your Google account. If the website
  only offers Google sign-in, add email/password sign-in to the website (repo
  `mauritsE/fretlane-sync-magic`) before you submit.
- Put two or three tabs in that account (one with a YouTube link), so the list isn't empty.
- Use a separate account, not your own, and change its password after the review.

**Contact information** (**YOU**): first name, last name, phone number with country code
(e.g. `+31 6 …`), email address. Apple only uses these to reach you about the review.

**Notes** (4000 bytes)
```
Fretlane is a guitar tab player. No login or account is needed for the app itself. The demo account above is only for the optional Fretlane Cloud window (step 7).

How to test:
1. Click any song in the library, e.g. "Greensleeves".
2. Press Play (or Space). The built-in synthesizer plays the song and the cursor follows the tab. Change Speed to 50% to hear it slowed down.
3. Press M to open the metronome and click "Use song tempo".
4. Go back to the library. The ☆ on a song card adds it to Favorites, ✓ moves it to the Archive (see the tabs at the top).
5. "+ Add song" → "Paste text" accepts a plain-text guitar tab; "Upload file" accepts Guitar Pro and MusicXML files.
6. Own audio file: open a song → Edit → "Audio file", pick any MP3 or WAV from the Mac → Save. Press Play: the tab follows the audio file. "⇆ Sync" shows its waveform; click the first beat and "Pin to recording time".
7. Fretlane Cloud (optional, for people who keep tabs in their account on the Fretlane website): click "☁ Cloud" in the library → "Sign in to Fretlane Cloud". This opens the website in the default browser; sign in there with the demo account and approve this Mac. The browser then returns to the app (see "About the entitlements" below) and the Cloud window lists the account's tabs. "Add & open" copies one into the local library. "Sign out" in the same window removes the sign-in from the Mac.

Optional features: a song can be linked to a YouTube video or a Spotify track. These play in YouTube's and Spotify's official embedded players. Spotify plays 30-second previews unless the user is logged in to Spotify; Fretlane never sees Spotify credentials.

About the entitlements: com.apple.security.network.server is needed because the app listens for and answers incoming connections. It runs a small HTTP server inside its own process, bound to 127.0.0.1 only (not reachable from other computers). (1) The app window, an Electron web view, loads the user interface and the song library from http://127.0.0.1:<port>/; without the entitlement the sandbox blocks the socket and the window stays empty. (2) Fretlane Cloud sign-in: after the user signs in on the website in their own browser, the browser is redirected to http://127.0.0.1:<port>/api/cloud/callback, a connection from another process that this server answers. com.apple.security.network.client is used for outgoing connections: YouTube/Spotify players, Fretlane Cloud, and downloading a tab from a link the user enters. File access is read-only and limited to files the user picks in the Open dialog (tab and audio files are copied into the library). The library is stored inside the app's sandbox container.

The 22 bundled songs are public-domain melodies (traditional songs and composers who died long ago) in our own arrangements. Fretlane bundles no third-party tabs. The app is open source: https://github.com/mauritsE/Fretlane
```

**Attachment**: none needed.

---

## Fretlane Cloud and App Review: know these before you submit

Cloud is the part of 0.3.0 most likely to draw questions. None of these is a certain rejection, but
each has caught other apps:

- **Guideline 3.1.1 / 3.1.3(b), paid content bought elsewhere.** Opening tabs from a paid account
  is allowed ("multiplatform services") as long as the app doesn't send people to buy outside the
  App Store. The app has an **About Fretlane Cloud** button that opens the website. If that page
  shows prices or a buy button, Apple may object. Easiest fix if they do: point the button at a page
  without prices, or remove it from the App Store build.
- **Guideline 4.8, Sign in with Apple.** Applies when an app uses a third-party login (such as
  Google) for its own account. Signing in happens on the website, not in the app, which usually keeps
  it out of scope, but a reviewer can still ask. Offering email/password on the website (needed for
  the demo account anyway) also answers this.
- **Guideline 5.1.1(v), account deletion.** Required when the app lets people *create* an account.
  Fretlane doesn't (accounts are made on the website), but make sure the website has a way to delete
  an account, in case they ask.

---

## 9. Version release

Choose **Manually release this version**, so you decide the moment it goes live after approval.

---

## 10. Business and legal (once per account)

- **EU trader status (Digital Services Act).** Selling a paid app means you are a **trader**. Apple
  shows your address, phone and email on the EU product page. See `SUBMITTING.md` step 6.4.
- **Accessibility Nutrition Labels.** Voluntary for now. Leave them empty until VoiceOver and the
  other features have been tested in the app; don't claim support that hasn't been checked.
