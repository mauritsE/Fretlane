/**
 * Browser test of the tab editor (Fretlane Premium) against a fake website + fake Supabase, like
 * e2e/cloud.ts. Needs a built UI (`npm run build`):
 *   npx tsx e2e/editor.ts
 *
 * Covers: the Premium upsell (signed out, then signed in without a plan, then unlocked by a
 * subscription), creating a song, typing a riff with the keyboard, the caret sitting on the typed
 * note, undo/redo, bars and copy/paste, autosave and reopening, playback from the cursor, adding a
 * track, the .gp export, "Edit a copy" of a demo song, and the API refusing writes once the plan
 * ends, and the songwriting assistant (write a riff, improve the selection, undo) against a canned
 * answer from the fake website. It also measures re-render times on a 200-bar song (M0 in docs/premium/tab-editor-spec.md)
 * and prints them. It does not prove the real website returns these rows; check that by hand.
 */
import { chromium, type Page } from 'playwright';
import http from 'node:http';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as alphaTab from '@coderline/alphatab';
import { dirAssets, startServer } from '../server/app.ts';
import type { CloudConfig } from '../shared/cloud.ts';
import type { SongDoc } from '../shared/editor/doc.ts';
import type { Cursor } from '../shared/editor/commands.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'e2e', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(ok: boolean, what: string): void {
  // DEBUG_ERRORS=1 shows after which step page errors appeared.
  console.log(`${ok ? '✓' : '✗'} ${what}${process.env.DEBUG_ERRORS ? ` [page errors so far: ${errors.length}]` : ''}`);
  if (!ok) failures++;
}

// ---------- fake website + Supabase ----------
let subscription: { status: string; current_period_end: string | null } | null = null;
/** Requests the fake website's songwriting assistant received. */
const riffRequests: { mode: string; prompt: string; bars: number; context: string }[] = [];
const eighthsBar = (fret: number, count = 8, string = 6) => ({ beats: Array.from({ length: count }, () => ({ duration: 8, dotted: false, triplet: false, notes: [{ string, fret, drum: 'none', techniques: [] }] })) });
/** Kick + hi-hat, hi-hat, snare + hi-hat, hi-hat … in eighths. */
const rockBar = () => ({
  beats: Array.from({ length: 8 }, (_, i) => ({ duration: 8, dotted: false, triplet: false, notes: (i % 4 === 0 ? ['kick', 'closedHiHat'] : i % 4 === 2 ? ['snare', 'closedHiHat'] : ['closedHiHat']).map((drum) => ({ string: 0, fret: 0, drum, techniques: [] })) })),
});
const guitarPart = (bars: unknown[]) => ({ track: 1, instrument: 'guitar', name: 'Guitar', bars });
const access = new Set<string>();
const refresh = new Set<string>();
let n = 0;
const issued = () => {
  n++;
  access.add(`a${n}`);
  refresh.add(`r${n}`);
  return { access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 3600, user: { email: 'writer@example.com' } };
};
const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let body = '';
  for await (const c of req) body += c;
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (url.pathname === '/connect') {
    const back = new URL(url.searchParams.get('return')!);
    back.searchParams.set('state', url.searchParams.get('state')!);
    back.searchParams.set('token_hash', 'hash-ok');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<a id="approve" href="${back.toString().replace(/"/g, '&quot;')}">Connect</a>`);
    return;
  }
  if (url.pathname === '/pricing') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<h1>Pricing</h1>');
    return;
  }
  if (req.headers.apikey !== 'pk') return json(401, { msg: 'no apikey' });
  const b = body ? (JSON.parse(body) as Record<string, string>) : {};
  if (url.pathname === '/auth/v1/verify') return b.token_hash === 'hash-ok' ? json(200, issued()) : json(403, { msg: 'invalid' });
  if (url.pathname === '/auth/v1/token') return refresh.delete(b.refresh_token) ? json(200, issued()) : json(400, { error_description: 'Invalid Refresh Token' });
  if (!access.has(String(req.headers.authorization).replace('Bearer ', ''))) return json(401, { message: 'JWT expired' });
  if (url.pathname === '/rest/v1/subscriptions') return json(200, subscription ? [subscription] : []);
  if (url.pathname === '/rest/v1/rpc/my_kofi_membership' && req.method === 'POST') return json(200, null);
  if (url.pathname === '/rest/v1/tabs') return json(200, []);
  if (url.pathname === '/api/public/app/riff-assistant' && req.method === 'POST') {
    // Stands in for the website calling Claude: a canned riff, so the test is about the app.
    const r = JSON.parse(body) as (typeof riffRequests)[number];
    riffRequests.push(r);
    if (subscription?.status !== 'active') return json(402, { error: 'The songwriting assistant comes with the Fretlane Cloud plan.' });
    if (/drums/.test(r.prompt)) {
      return json(200, {
        riff: {
          explanation: 'A riff with a bass line and a rock beat under it.',
          parts: [guitarPart([eighthsBar(0), eighthsBar(3)]), { track: 0, instrument: 'bass', name: 'Bass', bars: [eighthsBar(0, 8, 4), eighthsBar(3, 8, 4)] }, { track: 0, instrument: 'drums', name: 'Drums', bars: [rockBar(), rockBar()] }],
        },
      });
    }
    if (r.mode === 'generate') return json(200, { riff: { explanation: 'A funky two-bar riff on the low string.', parts: [guitarPart([eighthsBar(3, 9), eighthsBar(5)])] } });
    return json(200, { riff: { explanation: 'Moved it up to the seventh fret for a heavier sound.', parts: [guitarPart(Array.from({ length: r.bars }, () => eighthsBar(7)))] } });
  }
  json(404, {});
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
const fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
const cloud: CloudConfig = { siteUrl: fakeUrl, apiUrl: fakeUrl, apiKey: 'pk' };

// ---------- Fretlane ----------
const libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fretlane-editor-e2e-'));
const server = await startServer({ port: 0, host: '127.0.0.1', libraryDir, assets: dirAssets(path.join(ROOT, 'dist')), cloud, seed: path.join(ROOT, 'demo') });

const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
await context.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404, body: '' }));
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => void d.accept());

type EditorHandle = { doc: SongDoc; cursor: Cursor; song: { id: string; title: string }; timings: { changedBar: number; ms: number; bars: number }[]; idle: boolean; saved: boolean };
const ed = (p: Page = page) => p.evaluate(() => {
  const e = (window as unknown as { fretlane: { editor: EditorHandle } }).fretlane.editor;
  return { doc: e.doc, cursor: e.cursor, song: e.song, timings: e.timings, saved: e.saved };
});
/** Waits until every render the editor started has finished. */
async function rendered(p: Page = page): Promise<void> {
  await p.waitForFunction(() => {
    const w = window as unknown as { fretlane?: { editor?: EditorHandle; at: { isReadyForPlayback?: boolean } } };
    const e = w.fretlane?.editor;
    return !!e && e.timings.length > 0 && e.idle && !document.querySelector('.score-area .at-overlay:not(.hidden)');
  }, undefined, { timeout: 20000 });
  await p.waitForTimeout(80);
}
/** JSON with sorted keys, so documents compare by content. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const beats = (doc: SongDoc, bar = 0, track = 0) =>
  doc.bars[bar].tracks[track].map((b) => (b.notes.length ? `${b.notes.map((x) => `${x.fret}.${x.string}`).join('+')}:${b.duration}` : `r:${b.duration}${b.dotted ? '.' : ''}`)).join(' ');

// ---------- Premium upsell ----------
await page.goto(server.url);
await page.click('button.write-button');
await page.waitForSelector('.premium-dialog a.button.primary');
check(/Sign in to Fretlane Cloud/.test((await page.locator('.premium-dialog a.button.primary').textContent()) ?? ''), 'signed out: ✎ Write offers to sign in to Fretlane Cloud');
await page.screenshot({ path: path.join(SHOTS, 'editor-1-upsell.png') });
const [site] = await Promise.all([context.waitForEvent('page'), page.click('.premium-dialog a.button.primary')]);
await site.waitForLoadState();
await site.click('#approve');
await site.waitForLoadState();
await site.close();
await page.waitForFunction(() => /no active Fretlane Cloud plan/.test(document.querySelector('.premium-dialog')?.textContent ?? ''), undefined, { timeout: 15000 });
check(true, 'signed in without a plan: the dialog says so and links to the plan');
check((await page.locator('.premium-dialog a.button.primary').getAttribute('href')) === `${fakeUrl}/pricing`, 'the plan link goes to the website pricing page');
subscription = { status: 'active', current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() };
await page.click('.premium-dialog button:has-text("Check again")');
await page.waitForSelector('.write-dialog', { timeout: 10000 });
check(true, 'with an active subscription the dialog unlocks and the new-song dialog opens');

// ---------- new song ----------
await page.fill('.write-dialog input[name="title"]', 'E2E Riff');
await page.fill('.write-dialog input[name="tempo"]', '96');
await page.click('.write-dialog button[type="submit"]');
await page.waitForURL(/#\/write\//);
await rendered();
let s = await ed();
check(s.doc.title === 'E2E Riff' && s.doc.tempo === 96 && s.doc.bars.length === 4 && s.doc.tracks[0].tuning.length === 6, 'creates a song with 4 empty bars of standard-tuned guitar');
check(s.cursor.string === 6, 'the cursor starts on the low E string');

// ---------- typing ----------
await page.keyboard.press('3');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('5');
await page.keyboard.press('ArrowRight');
await page.keyboard.type('12', { delay: 60 });
await page.keyboard.press('ArrowUp');
await page.keyboard.press('1');
await page.keyboard.press('4');
await rendered();
s = await ed();
check(beats(s.doc).startsWith('3.6:8 5.6:8 14.5+12.6:8'), `digits type frets; two quick digits make 12; ↑ builds a chord (${beats(s.doc)})`);

// The caret sits on the note just typed: compare with alphaTab's own note-head bounds.
const caret = await page.evaluate(() => {
  const w = window as unknown as { fretlane: { at: alphaTab.AlphaTabApi } };
  const lookup = w.fretlane.at.boundsLookup!;
  const mb = lookup.staffSystems[0].bars[0];
  const beat = mb.bars[0].beats.find((b) => b.beat.index === 2)!;
  const head = beat.notes!.find((nb) => nb.note.fret === 14)!.noteHeadBounds;
  const c = document.querySelector('.editor-overlay .caret')!.getBoundingClientRect();
  const stack = document.querySelector('.at-stack')!.getBoundingClientRect();
  return { headX: head.x + head.w / 2, headY: head.y + head.h / 2, caretX: c.left - stack.left + c.width / 2, caretY: c.top - stack.top + c.height / 2 };
});
check(Math.abs(caret.headX - caret.caretX) < 6 && Math.abs(caret.headY - caret.caretY) < 4, `the caret is drawn on the typed note (caret ${caret.caretX.toFixed(1)},${caret.caretY.toFixed(1)} vs note ${caret.headX.toFixed(1)},${caret.headY.toFixed(1)})`);
await page.screenshot({ path: path.join(SHOTS, 'editor-2-typing.png') });

// Durations, techniques, rest.
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('-'); // eighth -> quarter for the next note
await page.keyboard.press('7');
await page.keyboard.press('h');
await rendered();
s = await ed();
const fourth = s.doc.bars[0].tracks[0][3];
check(fourth.duration === 4 && fourth.notes[0].fret === 7 && fourth.notes[0].hammer === true, '− makes the next note longer; H adds a hammer-on');
check(await page.locator('.edit-toolbar button.flag[data-flag="hammer"].active').count() === 1, 'the toolbar shows the hammer-on is on');

// Undo / redo.
await page.keyboard.press('Control+z');
await rendered();
check(!(await ed()).doc.bars[0].tracks[0][3].notes[0].hammer, 'Ctrl+Z undoes the hammer-on');
await page.keyboard.press('Control+Shift+z');
await rendered();
check(!!(await ed()).doc.bars[0].tracks[0][3].notes[0].hammer, 'Ctrl+Shift+Z redoes it');

// Delete removes the note, then the beat.
await page.keyboard.press('Delete');
await rendered();
check((await ed()).doc.bars[0].tracks[0][3].notes.length === 0, 'Delete removes the note under the cursor');

// ---------- bars ----------
await page.keyboard.press('Control+c');
await page.keyboard.press('Control+v');
await rendered();
s = await ed();
check(s.doc.bars.length === 5 && beats(s.doc, 1) === beats(s.doc, 0), 'Ctrl+C / Ctrl+V copies the bar in after the cursor');
await page.click('.edit-toolbar button:has-text("+ Bar")');
await rendered();
check((await ed()).doc.bars.length === 6, '+ Bar inserts a bar');
await page.click('.edit-toolbar button:has-text("− Bar")');
await rendered();
check((await ed()).doc.bars.length === 5, '− Bar deletes it again');
await page.selectOption('.edit-toolbar select', '3/4');
await rendered();
s = await ed();
check(s.doc.bars[s.cursor.bar].ts.join('/') === '3/4', 'the time signature changes from this bar on');
await page.keyboard.press('Control+z');
await rendered();
await page.click('.edit-toolbar button:has-text("Section")');
await page.fill('dialog input', 'Chorus');
await page.click('dialog button[type="submit"]');
await rendered();
s = await ed();
check(s.doc.bars[s.cursor.bar].section === 'Chorus' && /§ Chorus/.test((await page.locator('.edit-toolbar button:has-text("Chorus")').textContent()) ?? ''), '§ Section names the bar (a dialog, since Electron has no prompt())');
await page.keyboard.press('Space');
await page.keyboard.press('Space');
check((await ed()).doc.bars[s.cursor.bar].section === 'Chorus', 'Space after clicking a toolbar button plays instead of pressing the button again');

// A bar that doesn't add up is flagged: make the first note of bar 1 a whole note.
for (let i = 0; i < 6; i++) await page.keyboard.press('Control+ArrowLeft');
await page.keyboard.press('Home');
await page.keyboard.press('-');
await page.keyboard.press('-');
await page.keyboard.press('-');
await rendered();
s = await ed();
check(s.doc.bars[0].tracks[0][0].duration === 1, 'three times − makes the note a whole note');
check((await page.locator('.editor-overlay .bar-warn').count()) === 1 && /Bar 1 is .* too long/.test((await page.locator('.bar-warning').textContent()) ?? ''), 'the overfull bar gets a ⚠ in the tab and in the status bar');
await page.screenshot({ path: path.join(SHOTS, 'editor-2b-warning.png') });
for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
await rendered();
check((await page.locator('.editor-overlay .bar-warn').count()) === 0, 'undo makes it fit again and the ⚠ goes away');

// ---------- saving ----------
await page.waitForFunction(() => (window as unknown as { fretlane: { editor: EditorHandle } }).fretlane.editor.saved, undefined, { timeout: 10000 });
const id = (await ed()).song.id;
const savedTex = await (await fetch(`${server.url}/api/songs/${id}/tab`)).text();
check(savedTex.includes('\\title "E2E Riff"') && savedTex.includes('(14.5 12.6).8'), 'edits are saved to the library as alphaTex');
const before = (await ed()).doc;
await page.reload();
await rendered();
const reopened = (await ed()).doc;
check(stable(reopened) === stable(before), 'reopening the song shows exactly what was written');
if (stable(reopened) !== stable(before)) {
  reopened.bars.forEach((bar, i) => {
    if (JSON.stringify(bar) !== JSON.stringify(before.bars[i])) console.log(`    bar ${i}: saved ${JSON.stringify(before.bars[i])}\n    bar ${i}: reopened ${JSON.stringify(bar)}`);
  });
  const { bars: _a, ...headA } = reopened;
  const { bars: _b, ...headB } = before;
  if (JSON.stringify(headA) !== JSON.stringify(headB)) console.log('    head', JSON.stringify(headB), JSON.stringify(headA));
}

// ---------- songwriting assistant ----------
// Nothing selected: the riff starts in the cursor bar (the last one, still empty) and adds a bar after it.
await page.keyboard.press('Escape');
for (let i = 0; i < 6; i++) await page.keyboard.press('Control+ArrowRight');
check(/Write a new riff from bar 5/.test((await page.locator('.ai-mode').textContent()) ?? ''), 'riff assistant without a selection: offers to write a new riff from the cursor bar');
await page.click('.ai-ideas .chip >> nth=1');
check(/Funky/.test(await page.inputValue('.ai-prompt')), 'clicking an idea fills in the prompt');
await page.fill('.ai-prompt', 'a funky riff 12');
check((await ed()).doc.bars.length === 5 && stable((await ed()).doc) === stable(reopened), 'typing in the prompt box (digits too) does not edit the tab');
await page.locator('.ai-prompt').evaluate((el) => (el as HTMLTextAreaElement).blur());
await page.click('.ai-go');
await page.waitForSelector('.ai-result button:has-text("Try again")', { timeout: 15000 });
await rendered();
s = await ed();
const gen = riffRequests.at(-1)!;
check(gen?.mode === 'generate' && gen.prompt === 'a funky riff 12' && gen.bars === 2 && gen.context.includes('Tempo: 96 BPM') && gen.context.includes('What comes just before the new part'), 'the request carries the prompt, the bar count and the song context, through Fretlane Cloud');
check(s.doc.bars.length === 6 && beats(s.doc, 4) === Array(8).fill('3.6:8').join(' ') && beats(s.doc, 5) === Array(8).fill('5.6:8').join(' '), `the new riff fills the empty bar 5 and adds bar 6; the overlong bar is trimmed (${beats(s.doc, 4)})`);
const resultText = (await page.locator('.ai-result').textContent()) ?? '';
check(resultText.includes('A funky two-bar riff') && resultText.includes('trimmed or filled with rests') && resultText.includes('bars 5–6'), 'the result shows the explanation, says what was fixed and where the riff went');
check(/Bars 5–6 selected/.test((await page.locator('.edit-pos').textContent()) ?? '') && /Improve bars 5–6/.test((await page.locator('.ai-mode').textContent()) ?? ''), 'the new bars are selected, so the assistant now offers to improve them');
await page.screenshot({ path: path.join(SHOTS, 'editor-5-assistant.png') });

await page.fill('.ai-prompt', 'heavier');
await page.locator('.ai-prompt').evaluate((el) => (el as HTMLTextAreaElement).blur());
await page.click('.ai-go');
await page.waitForFunction(() => /seventh fret/.test(document.querySelector('.ai-result')?.textContent ?? ''), undefined, { timeout: 15000 });
await rendered();
s = await ed();
const imp = riffRequests.at(-1)!;
check(imp.mode === 'improve' && imp.bars === 2 && imp.prompt === 'heavier' && imp.context.includes('The selected bars (5–6)') && imp.context.includes('s6f5 1/8'), 'with bars selected the assistant sends them to be improved');
check(s.doc.bars.length === 6 && beats(s.doc, 4) === Array(8).fill('7.6:8').join(' ') && beats(s.doc, 5) === Array(8).fill('7.6:8').join(' '), 'the improved riff replaces the selected bars');
await page.click('.ai-result button:has-text("Undo")');
await rendered();
s = await ed();
check(beats(s.doc, 4) === Array(8).fill('3.6:8').join(' ') && (await page.locator('.ai-result.hidden').count()) === 1, '↶ Undo in the result takes the improvement back');
await page.keyboard.press('Control+z');
await rendered();
check(stable((await ed()).doc) === stable(reopened), 'Ctrl+Z takes the generated riff back too');
await page.screenshot({ path: path.join(SHOTS, 'editor-5b-assistant-undone.png') });

// More parts: a riff with bass and drums gets two new tracks.
await page.fill('.ai-prompt', 'a riff with bass and drums');
await page.locator('.ai-prompt').evaluate((el) => (el as HTMLTextAreaElement).blur());
await page.click('.ai-go');
await page.waitForFunction(() => /rock beat/.test(document.querySelector('.ai-result')?.textContent ?? ''), undefined, { timeout: 15000 });
await rendered();
s = await ed();
check(
  s.doc.tracks.map((t) => `${t.name}:${t.kind}`).join(',') === 'Guitar:guitar,Bass:bass,Drums:drums' && beats(s.doc, 4, 1) === Array(8).fill('0.4:8').join(' '),
  `asking for bass and drums adds a bass track and a drum track with their parts (${s.doc.tracks.map((t) => t.name).join(', ')})`,
);
check(/Guitar, Bass \(new track\) and Drums \(new track\), bars 5–6/.test((await page.locator('.ai-result').textContent()) ?? ''), 'the result says which tracks it wrote, and where');
check((await page.locator('.sidebar .track-list li').count()) === 3 && /Drum kit/.test((await page.locator('.sidebar .track-list li >> nth=2').textContent()) ?? ''), 'the new tracks show in the sidebar');
// The drum track shows as notation; the caret names the drum, and typing adds hits.
await page.click('.sidebar .track-list li >> nth=2');
await rendered();
check((await page.locator('.editor-overlay .caret-label').textContent()) === 'Kick' && /Drum: Kick/.test((await page.locator('.edit-pos').textContent()) ?? ''), 'on the drum track the caret and the status bar name the drum (starts on the kick)');
for (let i = 0; i < 4; i++) await page.keyboard.press('Control+ArrowLeft');
for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp'); // kick → floor tom → side stick → snare
await page.keyboard.press('1');
await rendered();
s = await ed();
const drumHits = s.doc.bars[s.cursor.bar].tracks[2][0].notes.map((n) => n.string);
check(s.cursor.track === 2 && drumHits.includes(8), `↑ picks the snare and a digit adds a hit on the drum track (lanes ${drumHits.join(',')})`);
await page.screenshot({ path: path.join(SHOTS, 'editor-5c-drums.png') });
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
await rendered();
check(stable((await ed()).doc) === stable(reopened) && (await page.locator('.sidebar .track-list li').count()) === 1, 'Ctrl+Z takes the hit and then the whole three-part riff back, tracks included');
await page.click('.sidebar .track-list li >> nth=0');
await page.keyboard.press('Escape');
await rendered();
for (let i = 0; i < 6; i++) await page.keyboard.press('Control+ArrowLeft');

// ---------- playback ----------
await page.keyboard.press('Space');
const played = await page
  .waitForFunction(() => (window as unknown as { fretlane: { at: alphaTab.AlphaTabApi } }).fretlane.at.playerState === 1, undefined, { timeout: 20000 })
  .then(() => true)
  .catch(() => false);
check(played, 'Space plays from the cursor (built-in synthesizer)');
await page.keyboard.press('Space');

// ---------- tracks ----------
await page.click('.sidebar .add-track');
await page.waitForSelector('dialog form');
await page.selectOption('dialog form select >> nth=0', 'bass');
await page.click('dialog button[type="submit"]');
await rendered();
s = await ed();
check(s.doc.tracks.length === 2 && s.doc.tracks[1].kind === 'bass' && s.doc.tracks[1].tuning.length === 4 && s.cursor.track === 1, '+ Track adds a bass track and switches to it');
await page.keyboard.press('0');
await rendered();
check((await ed()).doc.bars[0].tracks[1][0].notes[0]?.string === 4, 'typing works on the bass track (starts on its lowest string)');
await page.screenshot({ path: path.join(SHOTS, 'editor-3-bass.png') });

// ---------- export ----------
const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text(".gp")')]);
const gpFile = path.join(libraryDir, 'export.gp');
await download.saveAs(gpFile);
const gpScore = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(await fs.readFile(gpFile)), new alphaTab.Settings());
check(download.suggestedFilename() === 'E2E Riff.gp' && gpScore.tracks.length === 2 && gpScore.title === 'E2E Riff', '⤓ .gp downloads a Guitar Pro file alphaTab can open again');

// ---------- render timing on a long song (M0) ----------
await page.click('.sidebar .track-list li >> nth=0');
await rendered();
await page.keyboard.press('Control+ArrowLeft');
await page.keyboard.press('Control+ArrowLeft');
for (let i = 0; i < 4; i++) await page.keyboard.press('Control+ArrowLeft');
await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('Control+c');
for (let i = 0; i < 49; i++) await page.keyboard.press('Control+v');
await rendered();
s = await ed();
check(s.doc.bars.length >= 200, `pasting builds a long song (${s.doc.bars.length} bars)`);
/** Median time from an edit to alphaTab finishing the re-render, over five frets typed at the cursor. */
const measure = async () => {
  await page.evaluate(() => (window as unknown as { fretlane: { editor: EditorHandle } }).fretlane.editor.timings.splice(0));
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(String((i % 9) + 1));
    await rendered();
  }
  const t = (await ed()).timings.map((x) => x.ms).sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
};
// Near the end of the song (layout before it can be kept) …
for (let i = 0; i < 190; i++) await page.keyboard.press('Control+ArrowRight');
const lateMs = await measure();
// … and in bar 1 (everything after it changes).
for (let i = 0; i < 200; i++) await page.keyboard.press('Control+ArrowLeft');
const earlyMs = await measure();
console.log(`  M0 timing, ${s.doc.bars.length} bars: median ${lateMs} ms per keystroke near the end, ${earlyMs} ms in bar 1 (headless Chromium, this machine)`);
check(lateMs < 1000, 'typing near the end of a 200-bar song re-renders in under a second');
await page.screenshot({ path: path.join(SHOTS, 'editor-4-long.png') });

// ---------- the player links into the editor, and demo songs can be copied ----------
await page.goto(`${server.url}/#/song/${encodeURIComponent(id)}`);
await page.waitForSelector('a.button:has-text("Edit tab")', { timeout: 15000 });
check(true, 'a written song has "✎ Edit tab" in the player');
const songs = (await (await fetch(`${server.url}/api/songs`)).json()) as { id: string; title: string; written?: boolean; tabSource: string }[];
const demo = songs.find((x) => x.tabSource === 'rotterdam-riff.atex')!;
await page.goto(`${server.url}/#/song/${encodeURIComponent(demo.id)}`);
await page.waitForFunction(() => !!(window as unknown as { fretlane?: { at?: alphaTab.AlphaTabApi } }).fretlane?.at?.score, undefined, { timeout: 20000 });
await page.click('button:has-text("Make my version")');
await page.waitForURL(/#\/write\//, { timeout: 15000 });
await rendered();
s = await ed();
check(s.song.title === `${demo.title} (my version)` && s.doc.bars.length > 1, '"✎ Make my version" of a demo song opens an editable copy; the original stays');
check(!!songs.find((x) => x.id === demo.id) && !(await (await fetch(`${server.url}/api/songs/${demo.id}`)).json()).written, 'the demo song itself is not marked as written');

// ---------- plan ends ----------
subscription = { status: 'canceled', current_period_end: new Date(Date.now() - 86_400_000).toISOString() };
await fetch(`${server.url}/api/premium`, { method: 'POST' });
const refused = await fetch(`${server.url}/api/songs/${id}/tab`, { method: 'PUT', body: savedTex });
check(refused.status === 402, 'without a plan the API refuses to save (402)');
const aiRefused = await fetch(`${server.url}/api/assistant/riff`, { method: 'POST', body: JSON.stringify(gen) });
check(aiRefused.status === 402, 'without a plan the API refuses the riff assistant too (402)');
await page.goto(`${server.url}/#/write/${encodeURIComponent(id)}`);
await page.waitForSelector('.premium-dialog');
await page.click('.premium-dialog button:has-text("Not now")');
await page.waitForSelector('a.button:has-text("Open in the player")');
check(true, 'the editor offers the player instead; the song still plays');

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
await server.close();
fake.close();
await fs.rm(libraryDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
