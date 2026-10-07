# Privacy policy

_Last updated: 5 October 2026_

This policy covers the Fretlane desktop app (the GitHub downloads, the Mac App Store version, and the app run from source). Fretlane is made by Maurits Elzinga, who is responsible for the app as described here.

## In short

Fretlane does not collect, store or share any personal data. There is no account, no analytics, no crash reporting, no ads, and no server run by the developer. Your library stays on your computer.

Fretlane does contact a few third-party services, but only when you use a feature that needs them. Those are listed below.

## What stays on your computer

- **Your library:** songs, tab files, tags, favorites, the archive and sync pins are stored as plain files (`songs.json` plus the tab files) in the **Fretlane** folder in your home folder, or in the app's sandbox folder for the Mac App Store version.
- **Settings:** metronome settings are kept in the app's local browser storage. If you set up Spotify search, your Spotify developer Client ID and Client secret are saved in `settings.json` in your library folder. They are only ever sent to Spotify, and the app never shows the secret again once saved.
- **The local server:** Fretlane runs a small server inside the app that only listens on your own computer (`127.0.0.1`). Other devices on your network can't reach it.

Nothing in this list is sent to the developer.

## Third-party services Fretlane contacts

Each of these is contacted directly from your computer. The developer doesn't see these requests.

| When | Service | What is sent |
| --- | --- | --- |
| You open a song linked to a YouTube video | YouTube (Google), via its official embedded player from youtube.com | The video ID, plus whatever YouTube's player itself collects, such as your IP address and cookies |
| The library shows a song that has a YouTube video | YouTube's image server (`i.ytimg.com`) | The video ID, to load the thumbnail |
| You search for a recording on YouTube with **🔍 Find** | YouTube (`youtube.com`) | Your search words |
| You open a song linked to a Spotify track | Spotify, via its official embedded player from open.spotify.com | The track ID, plus whatever Spotify's player itself collects, including your Spotify login if you're logged in |
| You search for a recording on Spotify with **🔍 Find** | Spotify Web API (`accounts.spotify.com`, `api.spotify.com`) | Your Spotify developer Client ID and secret (to get an access token) and your search words |
| You import a tab **From URL** | The website at the address you entered | A normal download request for that address |
| You click a link to a website (for example Help → Report a Problem) | That website, opened in your normal browser | Whatever your browser sends |

If you log in to Spotify in its player, you log in with Spotify directly: Fretlane never sees your Spotify account or password.

Songs without a YouTube or Spotify link never contact YouTube or Spotify, and the bundled songs play with a built-in synthesizer that works offline.

YouTube's use of data is covered by [Google's privacy policy](https://policies.google.com/privacy). Spotify's use of data is covered by [Spotify's privacy policy](https://www.spotify.com/legal/privacy-policy/).

## Purchases

If you buy Fretlane on the Mac App Store, the purchase is handled by Apple under [Apple's privacy policy](https://www.apple.com/legal/privacy/). The developer receives sales reports from Apple but no personal information about you. Donations through Ko-fi are handled by Ko-fi under its own privacy policy.

## GitHub issues

If you report a problem or ask a question on GitHub, what you write is public and is handled by GitHub under [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Don't post personal information, Spotify secrets or private files there.

## Children

Fretlane doesn't collect personal data from anyone, including children. Linked YouTube and Spotify content is subject to those services' own age rules.

## Your rights

Because the developer holds no personal data about you, there is nothing to access, correct or delete on the developer's side. To delete everything Fretlane has stored, delete your **Fretlane** songs folder and uninstall the app. For data held by YouTube, Spotify, Apple or GitHub, use the tools those services provide.

## Changes to this policy

If Fretlane starts handling data differently, this page is updated before that version is released, and the date at the top changes. The full history of this page is visible on GitHub.

## Contact

Questions about privacy: open an issue at <https://github.com/mauritsE/Fretlane/issues>. See [Support](Support).
