# Write songs with your own Claude (MCP)

Fretlane includes an [MCP](https://modelcontextprotocol.io) server. It lets Claude Desktop, Claude Code or any other MCP client read your library and write songs into it, so Claude can compose with your own Claude subscription. You don't need the riff assistant's Fretlane Cloud plan for this.

Claude does the composing. Fretlane gives it four tools:

| Tool | What it does |
| --- | --- |
| `list_songs` | Lists your library (optionally filtered by title or artist). |
| `get_song` | Reads a song: tempo, time signature, sections, estimated key and chords, the tracks and their tunings, and every bar of every track. Can also show bars as ASCII tab. Reads any format the library holds (Guitar Pro, MusicXML, alphaTex). |
| `create_song` | Writes a new song: guitar, bass and drum tracks in any tuning, up to 256 bars. |
| `write_bars` | Changes a song written in Fretlane: improves bars in place, or adds new bars and new tracks. Needs Fretlane Premium (see below). |

Songs go through the same checks as the riff assistant: bar lengths, strings and frets the instrument has, stretches, drum hits a drummer can play, and staying in key. If a check finds a problem, nothing is saved. Claude gets the list of problems and sends a fixed version (or passes `force: true` to save the song anyway).

## Setting it up

Fretlane has to be running (the desktop app, `npm start` or `npm run dev`). The MCP server finds it on this computer by itself. If you run Fretlane on another port, set `FRETLANE_URL`, e.g. `http://localhost:5180`.

You need the source code and Node.js 20 or later, as described in [running-locally.md](running-locally.md). Run `npm install` once.

**Claude Code:**

```bash
claude mcp add fretlane -- npm run --silent --prefix /path/to/Fretlane mcp
```

**Claude Desktop:** open Settings → Developer → Edit Config and add:

```json
{
  "mcpServers": {
    "fretlane": {
      "command": "npm",
      "args": ["run", "--silent", "--prefix", "/path/to/Fretlane", "mcp"]
    }
  }
}
```

Restart Claude Desktop afterwards. Then ask something like *"Write a 16-bar folk song in DADGAD for guitar and bass, with an intro and a verse, and put it in Fretlane"* or *"Read Rotterdam Riff in Fretlane and write me a heavier version"*.

## What needs Premium

The MCP server doesn't get around the tab editor's plan:

- **Without Premium**, `create_song` saves the song as a normal tab. It plays in the player like an imported tab, but you can't open it in the tab editor, and `write_bars` can't change it. To change it, ask Claude to write a new version.
- **With Premium** (Fretlane Cloud plan, or the Mac App Store version), new songs are saved as songs written in Fretlane. You can edit them in the tab editor, and `write_bars` can change them in place. While you're signed in, they're backed up to Fretlane Cloud like anything else you write.

## For developers

- `server/mcp.ts` is the stdio entry (`npm run mcp`), and `server/mcpTools.ts` has the tools. The tools use the app's local HTTP API (`/api/songs`, `/api/songs/:id/tab`), so the app is still the only process that writes to the library, and new songs show up in its window.
- `shared/editor/songwriter.ts` turns what Claude sends into a `SongDoc`. It reuses the riff assistant's note format, fitting (`riffFromAnswer`, `applyRiff`) and checks (`riffProblems`).
- Tests: `tests/songwriter.test.ts` and `tests/mcp.test.ts`. The second one runs a real MCP client against a real server, with and without Premium.
