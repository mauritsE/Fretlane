# LinkedIn post (goes with `fretlane-demo.mp4`)

Written in your voice. Post it with the video uploaded natively (not as a link) and put the GitHub
link in the first comment: LinkedIn shows posts with links in the body to fewer people.

---

I've played drums since I was 12, and for years I wrote songs for my bands in Guitar Pro with a guitar on my lap. What I never had was a practice tool that felt like an instrument instead of software.

So I built one. It's called Fretlane. 🎸

🎵 Open a song and the whole band plays: melody, rhythm guitar, bass and drums, with a cursor that follows every note.
🐢 Slow it down to half speed, loop the hard part, switch to the bass line or the drum part.
⏱️ A metronome that picks up the song's tempo at your practice speed, or tap in your own.
⭐ Favorite songs, and an archive for the ones you've actually learned (the most satisfying button in the app).
📂 22 songs come built in, and you can bring your own Guitar Pro, MusicXML or plain-text tabs, even synced to a YouTube video.

The part I find most interesting as a product manager: I'm not a programmer. I built Fretlane with Claude Code, working the way I'd work with an engineering team: write down what "done" means, then insist on proof. Every song has a test that checks the tab plays exactly the notes written down. The whole app gets clicked through in a real browser before anything ships. That testing found real bugs, including one where drum parts crashed the tab view, before any user did.

It's a very different feeling from low-code, and a useful one for someone who spends his days building tools for developers at Mendix. The bottleneck moves from "how do I build this" to "do I know exactly what I want, and can I tell when it's right?"

Fretlane is free, open source, and runs on Mac, Windows and Linux. A Mac App Store version is on its way. Link in the comments. 👇

If you play: what's the first song you'd load into it?

#guitar #music #sideproject #AI #productmanagement #opensource

---

**First comment:** Download and source: https://github.com/mauritsE/Fretlane (free, MIT licence)

## Before you post, check
- "A Mac App Store version is on its way": keep it only if you plan to finish `appstore/SUBMITTING.md`. Otherwise delete the sentence.
- The drummer and Guitar Pro details come from what you've told me about yourself. Adjust anything that doesn't sound like you.
- The built-in songs are public-domain tunes (Greensleeves, House of the Rising Sun, Für Elise…), not chart hits. If someone asks for a specific pop song: that works through importing your own tab, not bundled.

## Shorter version (if you prefer)

Side project: I built Fretlane, a free guitar tab player where the whole band plays along. Slow it down, loop the tricky bar, use the metronome at your practice tempo, and archive songs once you've learned them. 22 songs built in, or import your own Guitar Pro tabs.

I'm not a programmer. I built it with Claude Code by being very precise about what "done" means and asking for proof, not promises. Link in the comments.

#guitar #sideproject #AI
