# Running Fretlane locally

This guide gets Fretlane running from the source code on your own computer: the app in your
browser, the tab editor, the riff assistant and the desktop app. If you only want to use Fretlane,
download the app instead (see the [README](../README.md#download-no-programming-needed)).

## 1. What you need

- **Node.js 20 or newer.** Get the LTS version from [nodejs.org](https://nodejs.org). Check it in
  a terminal with `node --version`.
- **Git**, to get the code. On macOS run `xcode-select --install` once; on Windows install
  [Git for Windows](https://git-scm.com/download/win).
- A browser. Chrome, Edge, Firefox and Safari all work.

## 2. Get the code and install

```bash
git clone https://github.com/mauritsE/Fretlane.git
cd Fretlane
npm install
```

`npm install` takes a minute or two. It downloads alphaTab, Vite, Electron and the test tools into
`node_modules/`.

## 3. Start it

```bash
npm run dev
```

Open **http://localhost:5173**. This runs two things:

- the UI (Vite) on port 5173. It reloads the page by itself when you change a file in `src/`.
- the API server on port 5174. It restarts by itself when you change a file in `server/` or
  `shared/`.

Stop both with **Ctrl+C**.

On the first start the library is filled with the demo tabs and the songbook, so there is something
to play straight away. Your songs live in `library/` in the project folder (`songs.json` plus the
tab and audio files). Git ignores that folder, so your songs never end up in a commit.

### Or: one process, the way users get it

```bash
npm start
```

This builds the UI once and serves the app and the API together on http://localhost:5173. Use it to
check the production build. It does not reload when you change code.

## 4. The tab editor and the riff assistant (Premium)

**✎ Write** and the **✨ Riff assistant** need Fretlane Premium, also when you run from source.

1. In the library, click **☁ Cloud** and sign in. Your browser opens the Fretlane website and
   sends you back to the app.
2. The account must have the Fretlane Cloud plan: an active subscription or Ko-fi membership.

The riff assistant then works in one of two ways:

- **Through the website (the default).** The website calls Claude with its own key. This only works
  once `ANTHROPIC_API_KEY` is set on the website and its `0005_ai_requests` migration has been
  applied (see `AGENTS.md` in `mauritsE/fretlane-sync-magic`).
- **With your own Claude API key.** Create a key at
  [console.anthropic.com](https://console.anthropic.com) (API use is billed separately from a Claude
  subscription, so add some credit under Billing). Then start Fretlane with the key set:

  ```bash
  # macOS / Linux
  FRETLANE_ANTHROPIC_API_KEY=sk-ant-... npm run dev
  ```

  ```powershell
  # Windows (PowerShell)
  $env:FRETLANE_ANTHROPIC_API_KEY = "sk-ant-..."
  npm run dev
  ```

  The app server calls Claude directly and the key never reaches the browser. Each request costs a
  few cents of API credit. The editor still checks for Premium, so you also need to be signed in
  (step 1). Don't put the key in a file inside the project folder: it could end up in a commit.

To try it: open a song you wrote, select a bar or two with **Shift + → / ←**, and press
**✨ Improve**. With nothing selected, type a description and press **✨ Write**. Ask for "a riff with bass and drums" to get the other parts on their own tracks.

## 5. The desktop app

```bash
npm run desktop
```

This builds everything and opens Fretlane in its own window (Electron). The desktop app keeps its
library in `~/Fretlane`, not in the project folder. To make an installer, see
[Desktop app and releases](../README.md#desktop-app-and-releases) in the README.

## 6. Settings

Set these as environment variables, the same way as the API key above.

| Variable | Default | What it does |
| --- | --- | --- |
| `FRETLANE_LIBRARY` | `./library` | Where your songs are stored. Point it at another folder to keep a separate test library. |
| `FRETLANE_PORT` | `5174` (`npm run dev` API), `5173` (`npm start`) | The server port. In `npm run dev` the UI expects the API on 5174, so only change this with `npm start`. |
| `FRETLANE_ANTHROPIC_API_KEY` | not set | Your own Claude API key for the riff assistant (see above). |
| `FRETLANE_SPOTIFY_CLIENT_ID`, `FRETLANE_SPOTIFY_CLIENT_SECRET` | not set | Spotify search in **🔍 Find**. You can also enter them in the app. |
| `FRETLANE_CLOUD_SITE`, `FRETLANE_CLOUD_API`, `FRETLANE_CLOUD_KEY` | the real website and its Supabase project | Point the app at another copy of the website, for example one you run locally. |

## 7. Checking your changes

```bash
npm run typecheck   # TypeScript
npm test            # unit tests (vitest)
npm run build       # production build, needed by the browser tests below
npm run e2e:editor  # the tab editor and riff assistant in a real browser, against a fake website
```

`npm run e2e:editor` doesn't call Claude: a fake website answers with a fixed riff. The full routine
(smoke test, Fretlane Cloud, desktop app) is in `.claude/skills/fretlane-verify/SKILL.md`. The
browser tests need Playwright's Chromium once: `npx playwright install chromium`.

## 8. When something goes wrong

| What you see | What to do |
| --- | --- |
| `Port 5173 is already in use` | Fretlane or another Vite app is already running. Close it, or find it with `lsof -i :5173` (macOS/Linux). |
| `EADDRINUSE ... 5174` | An earlier `npm run dev` is still running in another terminal. Stop it with Ctrl+C. |
| The page loads but shows no songs, or "Failed to fetch" | The API server isn't running. Check the terminal for an error from the `server` process. |
| No sound | Click somewhere in the page first: browsers only start audio after you interact with the page. |
| ✎ Write shows the Premium dialog | Sign in to Fretlane Cloud with an account that has the plan (step 4). |
| Riff assistant: "isn't set up on the website yet" | The website has no `ANTHROPIC_API_KEY` yet. Set it there, or use your own key. |
| Riff assistant: "The Claude API rejected FRETLANE_ANTHROPIC_API_KEY" | The key is wrong, revoked, or the account has no credit. |
| `npm install` fails on Electron | Run `npm install` again. If it keeps failing behind a proxy, `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install` skips Electron; everything except the desktop app still works. |
| Start over with a fresh library | Stop the app and delete everything in `library/` except `.gitkeep` (this deletes your songs). The next start fills it with the demo songs again. |
