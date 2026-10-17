import * as alphaTab from '@coderline/alphatab';
import type { Song } from '../shared/types.ts';
import { APP_NAME } from '../shared/brand.ts';
import {
  DURATIONS,
  TIME_SIGNATURES,
  barStatus,
  describeTicks,
  laneName,
  pitchName,
  type DocBar,
  type DocTrack,
  type DurationValue,
  type SongDoc,
  type TrackKind,
} from '../shared/editor/doc.ts';
import { docToTex } from '../shared/editor/tex.ts';
import { scoreToDoc } from '../shared/editor/fromScore.ts';
import * as cmd from '../shared/editor/commands.ts';
import {
  MAX_PROMPT_CHARS,
  MAX_RIFF_BARS,
  applyRiff,
  buildRiffRequest,
  riffRequestProblem,
  describeWritten,
  riffFromAnswer,
  type RiffRequest,
  type RiffTarget,
} from '../shared/editor/assistant.ts';
import type { Cursor, Edit, Entry, NoteFlag } from '../shared/editor/commands.ts';
import { api } from './api.ts';
import { h, toast } from './dom.ts';
import { metronomeButton } from './metronome.ts';
import { drumHit, pluck } from './pluck.ts';
import { ensurePremium } from './premiumView.ts';
import { makeEditableCopy, soundSelect, tuningField } from './writeDialog.ts';

type Cleanup = () => void;

/** Copied bars, kept while the app is open so they can be pasted into another song too. */
let clipboard: DocBar[] = [];

const DURATION_LABELS: Record<DurationValue, string> = { 1: '𝅝', 2: '𝅗𝅥', 4: '♩', 8: '♪', 16: '𝅘𝅥𝅯', 32: '𝅘𝅥𝅰' };
const DURATION_NAMES: Record<DurationValue, string> = { 1: 'Whole', 2: 'Half', 4: 'Quarter', 8: 'Eighth', 16: 'Sixteenth', 32: 'Thirty-second' };
const SAVE_DELAY_MS = 700;
/** Two digits typed this quickly on the same spot make one fret (1 then 2 = 12). */
const TWO_DIGIT_MS = 700;
/**
 * alphaTab starts its Web Audio output asynchronously after play(). A pause, a stop or a MIDI
 * reload (every re-render) before that throws in the browser ("cannot call stop without calling
 * start first"), so those wait until this long after play().
 */
const PLAY_STARTUP_MS = 300;

const FLAG_KEYS: Record<string, NoteFlag> = { h: 'hammer', s: 'slide', v: 'vibrato', b: 'bend', p: 'palmMute', l: 'letRing', x: 'dead', t: 'tie' };
const FLAG_BUTTONS: { flag: NoteFlag; label: string; key: string }[] = [
  { flag: 'hammer', label: 'H/P', key: 'H' },
  { flag: 'slide', label: 'Slide', key: 'S' },
  { flag: 'vibrato', label: '〰', key: 'V' },
  { flag: 'bend', label: 'Bend', key: 'B' },
  { flag: 'palmMute', label: 'P.M.', key: 'P' },
  { flag: 'letRing', label: 'Let ring', key: 'L' },
  { flag: 'dead', label: '✕ Dead', key: 'X' },
  { flag: 'tie', label: '⌒ Tie', key: 'T' },
];

const SHORTCUTS: [string, string][] = [
  ['0 – 9', 'Fret on the cursor string (type two digits quickly for 10 – 30)'],
  ['← →', 'Previous / next beat (→ at the end adds a bar)'],
  ['↑ ↓', 'String up / down'],
  ['Ctrl + ← →', 'Previous / next bar'],
  ['Shift + ← →', 'Select bars'],
  ['+  −', 'Shorter / longer note'],
  ['.', 'Dotted'],
  ['Shift + T', 'Triplet'],
  ['R', 'Make the beat a rest'],
  ['Delete / Backspace', 'Remove the note, then the beat'],
  ['Insert or I', 'Insert a beat before the cursor'],
  ['H S V B P L X T', 'Hammer/pull, slide, vibrato, bend, palm mute, let ring, dead note, tie'],
  ['Drum track', '↑ ↓ pick the drum, any digit adds a hit, Delete removes it'],
  ['Ctrl + C / X / V', 'Copy / cut / paste bars (paste goes after the cursor bar)'],
  ['Ctrl + Delete', 'Delete the selected bars'],
  ['Ctrl + Z, Ctrl + Shift + Z', 'Undo, redo'],
  ['Space', 'Play from the cursor / pause'],
  ['Esc', 'Clear the bar selection'],
];

/** Starting points for the riff assistant, filled into the prompt box with a click. */
const IMPROVE_IDEAS = ['Make it heavier', 'More groove', 'Add a bass line and drums', 'Add a second guitar that harmonises', 'Add a fill at the end'];
const GENERATE_IDEAS: Record<TrackKind, string[]> = {
  guitar: ['Palm-muted chug, in the style of 2000s metal', 'Funky sixteenth-note riff in E minor, with bass and drums', 'Bluesy shuffle in A', 'Slow, dark doom riff with drums', 'Two guitars: a riff and a harmony'],
  bass: ['Driving eighth-note bass line in E', 'Funky groove in A, with drums', 'Walking blues bass line in G', 'Simple root-fifth groove for a chorus'],
  drums: ['Straight rock beat', 'Half-time groove with ghost notes', 'Driving punk beat', 'Shuffle feel on the ride'],
};

function parseTex(tex: string): alphaTab.model.Score {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  return importer.readScore();
}

/** Renders the tab editor (route #/write/<id>) and returns a cleanup function. */
export async function renderEditor(root: HTMLElement, songId: string): Promise<Cleanup> {
  let song: Song;
  let tab: Uint8Array;
  try {
    [song, tab] = await Promise.all([api.getSong(songId), api.getTab(songId)]);
  } catch (err) {
    root.replaceChildren(h('main.library', {}, h('p.empty', {}, `Could not open song: ${(err as Error).message}. `, h('a', { href: '#/' }, 'Back to library'))));
    return () => {};
  }

  const notice = (text: string, ...actions: HTMLElement[]) =>
    root.replaceChildren(h('main.library', {}, h('div.empty', {}, h('p', {}, text), h('div.cloud-actions.center', {}, ...actions))));

  if (!song.written) {
    const copy = h('button.primary', {}, '✎ Make an editable copy');
    copy.onclick = async () => {
      try {
        const score = song.tabFormat === 'alphatex' ? parseTex(new TextDecoder().decode(tab)) : alphaTab.importer.ScoreLoader.loadScoreFromBytes(tab, new alphaTab.Settings());
        await makeEditableCopy(song, score);
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    };
    notice(`"${song.title}" was not written in ${APP_NAME}, so the editor would lose what it can't show. Edit a copy instead; the original stays as it is.`, copy, h('a.button', { href: `#/song/${encodeURIComponent(song.id)}` }, '▶ Open in the player'));
    return () => {};
  }
  if (!(await ensurePremium())) {
    notice('Editing needs Fretlane Premium. The songs you wrote still play in the player.', h('a.button.primary', { href: `#/song/${encodeURIComponent(song.id)}` }, '▶ Open in the player'), h('a.button', { href: '#/' }, 'Back to library'));
    return () => {};
  }

  let doc: SongDoc;
  try {
    doc = scoreToDoc(parseTex(new TextDecoder().decode(tab))).doc;
  } catch (err) {
    notice(`Could not read this song's tab: ${(err as Error).message}`, h('a.button', { href: '#/' }, 'Back to library'));
    return () => {};
  }

  const cleanups: Cleanup[] = [];
  const history = new cmd.History();
  const firstTrack = Math.min(song.defaultTrack, doc.tracks.length - 1);
  let cursor: Cursor = { track: firstTrack, bar: 0, beat: 0, string: doc.tracks[firstTrack].tuning.length };
  let entry: Entry = { duration: 8 };
  /** Bar selection for copy, delete and loop: anchor bar + the cursor bar. */
  let selectAnchor: number | null = null;
  let renderedTrack = -1;
  let current: alphaTab.model.Score | null = null;
  const timings: { changedBar: number; ms: number; bars: number }[] = [];

  // ---------- layout ----------
  const titleEl = h('button.song-heading.link', { title: 'Song title, artist and tempo' });
  const saveEl = h('span.save-state', {}, 'Saved');
  const undoBtn = h('button.icon', { title: 'Undo (Ctrl+Z)' }, '↶');
  const redoBtn = h('button.icon', { title: 'Redo (Ctrl+Shift+Z)' }, '↷');
  const trackList = h('ul.track-list');
  const tabHost = h('div.at-host');
  const overlay = h('div.editor-overlay');
  const stack = h('div.at-stack', {}, tabHost, overlay);
  const viewport = h('div.at-viewport.editor-viewport', {}, stack);
  const loading = h('div.at-overlay', {}, h('div.spinner'), h('span', {}, 'Loading…'));

  const durationBtns = DURATIONS.map((d) =>
    h('button.dur', { title: `${DURATION_NAMES[d]} (+ / − to change)`, 'data-duration': d, onclick: () => pickDuration(d) }, DURATION_LABELS[d]),
  );
  const dotBtn = h('button.dur', { title: 'Dotted (.)', onclick: () => toggleEntry('dotted') }, '•');
  const tripletBtn = h('button.dur', { title: 'Triplet (Shift+T)', onclick: () => toggleEntry('triplet') }, '3');
  const restBtn = h('button.dur', { title: 'Make a rest (R)', onclick: () => apply(cmd.makeRest(doc, cursor)) }, '𝄽');
  const flagBtns = FLAG_BUTTONS.map(({ flag, label, key }) =>
    h('button.flag', { title: `${cmd.NOTE_FLAG_LABELS[flag]} (${key})`, 'data-flag': flag, onclick: () => apply(cmd.toggleNoteFlag(doc, cursor, flag)) }, label),
  );
  const tsSel = h('select', { title: 'Time signature from this bar on' }, ...TIME_SIGNATURES.map((t) => h('option', { value: t.join('/') }, t.join('/'))));
  const tempoInput = h('input.bar-tempo', { type: 'number', min: 20, max: 400, title: 'Tempo from this bar on (BPM)' });
  const repeatStartBtn = h('button.flag', { title: 'Repeat starts here', onclick: () => apply(cmd.toggleRepeatStart(doc, cursor)) }, '𝄆');
  const repeatEndBtn = h('button.flag', { title: 'Repeat ends here: click for ×2, ×3, ×4, off', onclick: () => apply(cmd.cycleRepeatEnd(doc, cursor)) }, '𝄇');
  const sectionBtn = h('button.flag', { title: 'Section name (Intro, Verse, Chorus…)', onclick: () => editSection() }, '§ Section');

  const playBtn = h('button.play', { title: 'Play from the cursor / pause (Space)' }, '▶');
  const stopBtn = h('button.icon', { title: 'Stop' }, '⏹');
  const posEl = h('span.edit-pos');
  const warnEl = h('span.bar-warning');
  const speedSel = h('select', { title: 'Playback speed' }, ...[0.5, 0.6, 0.75, 0.9, 1, 1.25].map((r) => h('option', { value: r, selected: r === 1 }, `${Math.round(r * 100)}%`)));
  const loopBtn = h('button.toggle', { title: 'Loop the selected bars (or the cursor bar)' }, '⟲ Loop');
  const zoomSel = h('select', { title: 'Zoom' }, ...[0.75, 0.9, 1, 1.2, 1.4].map((z) => h('option', { value: z, selected: z === 1 }, `${Math.round(z * 100)}%`)));

  const aiMode = h('p.ai-mode');
  const aiPrompt = h('textarea.ai-prompt', { rows: 3, maxlength: MAX_PROMPT_CHARS, 'aria-label': 'What the assistant should do' });
  const aiIdeas = h('div.ai-ideas');
  const aiBars = h('select', { title: 'How many bars to write' }, ...[1, 2, 4, 8].map((n) => h('option', { value: n, selected: n === 2 }, `${n} bar${n === 1 ? '' : 's'}`)));
  const aiBarsLabel = h('label.inline', {}, aiBars);
  const aiGo = h('button.primary.ai-go', { title: 'Ctrl+Enter in the box does the same' });
  const aiResult = h('div.ai-result.hidden');
  const aiPanel = h('section.ai-panel', {}, h('h3', {}, '✨ Riff assistant'), aiMode, aiPrompt, aiIdeas, h('div.ai-row', {}, aiBarsLabel, h('span.spacer'), aiGo), aiResult);

  root.replaceChildren(
    h(
      'header.topbar',
      {},
      h('a.back', { href: '#/', title: 'Library' }, '←'),
      h('a.brand', { href: '#/' }, h('img.logo', { src: '/icon.svg', alt: APP_NAME })),
      h('span.badge.write-badge', {}, '✎ Writing'),
      titleEl,
      h('span.spacer'),
      saveEl,
      undoBtn,
      redoBtn,
      metronomeButton(),
      h('button', { title: 'Download as a Guitar Pro file', onclick: () => exportGp() }, '⤓ .gp'),
      h('a.button', { href: `#/song/${encodeURIComponent(song.id)}`, title: 'Practise this song in the player' }, '▶ Practise'),
      h('button.icon', { title: 'Keyboard shortcuts', onclick: () => showHelp() }, '?'),
    ),
    h(
      'div.player-layout',
      {},
      h(
        'aside.sidebar',
        {},
        h('h3', {}, 'Tracks'),
        trackList,
        h('button.add-track', { onclick: () => openTrackDialog(null) }, '+ Track'),
        h('p.hint.sidebar-hint', {}, 'Type fret numbers. Arrows move. Press ? for all keys.'),
        aiPanel,
      ),
      h(
        'section.editor-area',
        {},
        h(
          'div.edit-toolbar',
          {},
          h('span.group', {}, ...durationBtns, dotBtn, tripletBtn, restBtn),
          h('span.group', {}, ...flagBtns),
          h(
            'span.group',
            {},
            h('button.flag', { title: 'Insert a bar after this one', onclick: () => apply(cmd.insertBar(doc, cursor)) }, '+ Bar'),
            h('button.flag', { title: 'Delete the selected bars (Ctrl+Delete)', onclick: () => deleteSelectedBars() }, '− Bar'),
            h('button.flag', { title: 'Copy the selected bars (Ctrl+C)', onclick: () => copySelection() }, 'Copy'),
            h('button.flag', { title: 'Paste after this bar (Ctrl+V)', onclick: () => paste() }, 'Paste'),
            repeatStartBtn,
            repeatEndBtn,
            sectionBtn,
            h('label.inline', {}, tsSel),
            h('label.inline', { title: 'Tempo from this bar on' }, '♩=', tempoInput),
          ),
        ),
        h('div.score-area', {}, viewport, loading),
      ),
    ),
    h('footer.controls', {}, stopBtn, playBtn, posEl, warnEl, h('span.spacer'), h('label.inline', {}, 'Speed', speedSel), loopBtn, h('label.inline', {}, 'Zoom', zoomSel)),
  );

  // Toolbar and sidebar buttons don't take the focus, so Space and the other keys keep going to
  // the editor instead of pressing the last clicked button.
  for (const bar of root.querySelectorAll('.edit-toolbar, .sidebar')) {
    bar.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
  }

  // ---------- alphaTab ----------
  const at = new alphaTab.AlphaTabApi(tabHost, {
    core: {
      fontDirectory: `${import.meta.env.BASE_URL}font/`,
      logLevel: import.meta.env.DEV ? alphaTab.LogLevel.Info : alphaTab.LogLevel.Warning,
      includeNoteBounds: true,
    },
    display: { scale: 1, layoutMode: alphaTab.LayoutMode.Page, staveProfile: alphaTab.StaveProfile.Tab },
    player: {
      enablePlayer: true,
      playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
      soundFont: `${import.meta.env.BASE_URL}soundfont/sonivox.sf2`,
      scrollElement: viewport,
      enableCursor: true,
      enableAnimatedBeatCursor: true,
      // Clicks place the edit cursor (handled below) instead of seeking or selecting.
      enableUserInteraction: false,
      scrollMode: alphaTab.ScrollMode.Off,
    },
  } satisfies alphaTab.json.SettingsJson);
  cleanups.push(() => at.destroy());

  let playStartedAt = 0;
  let pauseTimer: number | undefined;
  let deferTimer: number | undefined;
  cleanups.push(() => window.clearTimeout(pauseTimer), () => window.clearTimeout(deferTimer));
  let renderStartedAt = 0;
  let renderingChange = -1;
  let rendering = false;
  /** Lowest changed bar of edits made while a render was running; -2 = nothing pending. */
  let pending = -2;

  at.error.on((e) => {
    loading.classList.add('hidden');
    rendering = false;
    toast(`Tab error: ${e.message}`, 'error');
  });
  at.postRenderFinished.on(() => {
    loading.classList.add('hidden');
    timings.push({ changedBar: renderingChange, ms: Math.round(performance.now() - renderStartedAt), bars: doc.bars.length });
    if (timings.length > 200) timings.shift();
    rendering = false;
    if (pending !== -2) {
      const next = pending;
      pending = -2;
      render(next);
    } else drawOverlay();
  });
  at.playerStateChanged.on((e) => {
    const playing = e.state === alphaTab.synth.PlayerState.Playing;
    playBtn.textContent = playing ? '⏸' : '▶';
    // alphaTab's playback cursor only while playing; otherwise the edit caret is the cursor.
    stack.classList.toggle('playing', playing);
  });

  (window as unknown as { fretlane: unknown }).fretlane = {
    at,
    editor: {
      get doc() {
        return doc;
      },
      get cursor() {
        return cursor;
      },
      get song() {
        return song;
      },
      timings,
      /** No render running or waiting (for tests). */
      get idle() {
        return !rendering && pending === -2;
      },
      get saved() {
        return !dirty && !saving;
      },
      /** The riff assistant is waiting for Claude (for tests). */
      get assistantBusy() {
        return aiBusy !== null;
      },
    },
  };

  /** Re-renders from the document. `changedBar` lets alphaTab keep the layout of the bars before it. */
  function render(changedBar: number): void {
    const startup = playStartedAt + PLAY_STARTUP_MS - performance.now();
    if (rendering || startup > 0) {
      pending = pending === -2 ? changedBar : Math.min(pending, changedBar);
      if (!rendering) {
        window.clearTimeout(deferTimer);
        deferTimer = window.setTimeout(() => {
          if (rendering || pending === -2) return;
          const next = pending;
          pending = -2;
          render(next);
        }, startup);
      }
      return;
    }
    rendering = true;
    renderStartedAt = performance.now();
    renderingChange = changedBar;
    current = parseTex(docToTex(doc));
    const sameTrack = renderedTrack === cursor.track;
    renderedTrack = cursor.track;
    // Drums have no tab staff: show them as notation (a lone drum track has nothing to draw as tab).
    const profile = doc.tracks[cursor.track].kind === 'drums' ? alphaTab.StaveProfile.Score : alphaTab.StaveProfile.Tab;
    if (at.settings.display.staveProfile !== profile) {
      at.settings.display.staveProfile = profile;
      at.updateSettings();
    }
    const hints: NonNullable<Parameters<typeof at.renderScore>[2]> = { reuseViewport: true };
    if (sameTrack && changedBar > 0) hints.firstChangedMasterBar = changedBar;
    at.renderScore(current, [cursor.track], hints);
  }

  // ---------- applying edits ----------
  function apply(e: Edit, opts: { audition?: boolean } = {}): void {
    if (e.message) toast(e.message);
    const changed = e.changedBar >= 0;
    if (changed) {
      history.push({ doc, cursor });
      doc = e.doc;
    }
    cursor = cmd.clampCursor(doc, e.cursor);
    afterChange(changed ? e.changedBar : -1);
    if (opts.audition) audition();
  }

  function afterChange(changedBar: number): void {
    if (changedBar >= 0) {
      render(changedBar);
      scheduleSave();
    } else {
      drawOverlay();
    }
    syncEntryToBeat();
    drawToolbar();
    drawStatus();
    drawTracks();
    drawAssistant();
    titleEl.replaceChildren(h('strong', {}, doc.title), h('span', {}, ` — ${doc.artist}`));
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
  }

  function restore(snap: cmd.Snapshot | null): void {
    if (!snap) return;
    const trackChanged = snap.doc.tracks.length !== doc.tracks.length;
    doc = snap.doc;
    cursor = cmd.clampCursor(doc, snap.cursor);
    if (trackChanged) renderedTrack = -1;
    afterChange(0);
  }
  undoBtn.onclick = () => restore(history.undo({ doc, cursor }));
  redoBtn.onclick = () => restore(history.redo({ doc, cursor }));

  /** Plays the note just typed, so typing is heard (see pluck.ts for why not alphaTab's playNote). */
  function audition(): void {
    if (at.playerState === alphaTab.synth.PlayerState.Playing) return;
    const track = doc.tracks[cursor.track];
    const note = beatAtCursor()?.notes.find((n) => n.string === cursor.string);
    if (note && track.kind === 'drums') drumHit(track.tuning[note.string - 1]);
    else if (note && !note.dead) pluck([track.tuning[note.string - 1] + note.fret]);
  }

  // ---------- saving ----------
  let dirty = false;
  let saving = false;
  let saveTimer: number | undefined;
  function scheduleSave(): void {
    dirty = true;
    saveEl.textContent = 'Saving…';
    saveEl.classList.remove('error');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), SAVE_DELAY_MS);
  }
  async function save(keepalive = false): Promise<void> {
    window.clearTimeout(saveTimer);
    if (!dirty) return;
    if (saving && !keepalive) {
      saveTimer = window.setTimeout(() => void save(), SAVE_DELAY_MS);
      return;
    }
    dirty = false;
    saving = true;
    const tex = docToTex(doc);
    try {
      // Browsers refuse keepalive bodies over 64 KB; a long song then saves without it.
      song = await api.saveTab(song.id, tex, keepalive && tex.length < 60_000);
      if (!dirty) saveEl.textContent = 'Saved';
    } catch (err) {
      dirty = true;
      saveEl.textContent = 'Not saved';
      saveEl.classList.add('error');
      saveEl.title = (err as Error).message;
      toast(`Not saved: ${(err as Error).message}`, 'error');
    } finally {
      saving = false;
    }
  }
  const onUnload = () => void save(true);
  window.addEventListener('beforeunload', onUnload);
  cleanups.push(() => {
    window.removeEventListener('beforeunload', onUnload);
    // Leaving for another page of the app: the page stays, so a normal request finishes.
    void save();
  });

  // ---------- drawing ----------
  function selection(): cmd.BarRange {
    return selectAnchor === null ? { from: cursor.bar, to: cursor.bar } : cmd.normalizeRange({ from: selectAnchor, to: cursor.bar }, doc);
  }

  function beatAtCursor() {
    return doc.bars[cursor.bar]?.tracks[cursor.track]?.[cursor.beat];
  }

  /** The current beat's length becomes the length for the next notes, like Guitar Pro. */
  function syncEntryToBeat(): void {
    const b = beatAtCursor();
    if (b?.notes.length) entry = { duration: b.duration, ...(b.dotted ? { dotted: true } : {}), ...(b.triplet ? { triplet: true } : {}) };
  }

  function drawToolbar(): void {
    for (const btn of durationBtns) btn.classList.toggle('active', Number(btn.dataset.duration) === entry.duration);
    dotBtn.classList.toggle('active', !!entry.dotted);
    tripletBtn.classList.toggle('active', !!entry.triplet);
    const note = beatAtCursor()?.notes.find((n) => n.string === cursor.string);
    for (const btn of flagBtns) {
      const flag = btn.dataset.flag as NoteFlag;
      btn.classList.toggle('active', !!note?.[flag]);
      btn.disabled = !note || doc.tracks[cursor.track].kind === 'drums';
    }
    const bar = doc.bars[cursor.bar];
    tsSel.value = bar.ts.join('/');
    tempoInput.value = String(tempoAt(cursor.bar));
    repeatStartBtn.classList.toggle('active', !!bar.repeatStart);
    repeatEndBtn.classList.toggle('active', !!bar.repeatEnd);
    repeatEndBtn.textContent = bar.repeatEnd ? `𝄇×${bar.repeatEnd}` : '𝄇';
    sectionBtn.classList.toggle('active', !!bar.section);
    sectionBtn.textContent = bar.section ? `§ ${bar.section}` : '§ Section';
  }

  function tempoAt(bar: number): number {
    for (let i = bar; i > 0; i--) if (doc.bars[i].tempo) return doc.bars[i].tempo!;
    return doc.tempo;
  }

  function drawStatus(): void {
    const track = doc.tracks[cursor.track];
    const beats = doc.bars[cursor.bar].tracks[cursor.track].length;
    const r = selection();
    posEl.textContent =
      `Bar ${cursor.bar + 1}/${doc.bars.length} · Beat ${cursor.beat + 1}/${beats} · ${track.kind === 'drums' ? `Drum: ${laneName(track, cursor.string)}` : `String ${cursor.string} (${laneName(track, cursor.string)})`}` +
      (r.from !== r.to ? ` · Bars ${r.from + 1}–${r.to + 1} selected` : '');
    const st = barStatus(doc, cursor.track, cursor.bar);
    warnEl.textContent = st.diff ? `⚠ Bar ${cursor.bar + 1} is ${describeTicks(st.diff)} ${st.diff < 0 ? 'short' : 'too long'}` : '';
  }

  function drawTracks(): void {
    trackList.replaceChildren(
      ...doc.tracks.map((t, i) =>
        h(
          'li',
          {
            class: i === cursor.track ? 'active' : '',
            onclick: () => {
              if (i === cursor.track) return;
              cursor = cmd.clampCursor(doc, { ...cursor, track: i, beat: 0, string: t.tuning.length });
              render(0);
              afterChange(-1);
            },
          },
          h('span.track-name', {}, t.name),
          h('small', {}, t.kind === 'drums' ? 'Drum kit' : `${t.kind === 'bass' ? 'Bass' : 'Guitar'} · ${[...t.tuning].reverse().map((p) => pitchName(p).replace(/-?\d+$/, '')).join(' ')}`),
          h(
            'span.track-buttons',
            {},
            h(
              'button.mini',
              {
                title: 'Track settings',
                onclick: (e: Event) => {
                  e.stopPropagation();
                  openTrackDialog(i);
                },
              },
              '⚙',
            ),
          ),
        ),
      ),
    );
  }

  /** The rendered bounds of a bar of the shown track. */
  function barBounds(bar: number): alphaTab.rendering.BarBounds | null {
    const lookup = at.boundsLookup;
    if (!lookup) return null;
    for (const system of lookup.staffSystems) {
      for (const mb of system.bars) if (mb.index === bar) return mb.bars[0] ?? null;
    }
    return null;
  }

  /**
   * Where a string line is drawn in a bar. The tab staff's lines are evenly spaced across the bar's
   * visual bounds (checked against note heads in the browser test).
   */
  function stringY(bb: alphaTab.rendering.BarBounds, string: number): number {
    const strings = doc.tracks[cursor.track].tuning.length;
    const { y, h: height } = bb.visualBounds;
    return y + ((string - 1) * height) / Math.max(1, strings - 1);
  }

  function drawOverlay(): void {
    const marks: HTMLElement[] = [];
    const r = selection();
    for (let i = r.from; i <= r.to; i++) {
      const bb = barBounds(i);
      if (bb && r.from !== r.to) marks.push(box('sel', bb.visualBounds.x, bb.visualBounds.y - 6, bb.visualBounds.w, bb.visualBounds.h + 12));
    }
    for (let i = 0; i < doc.bars.length; i++) {
      const st = barStatus(doc, cursor.track, i);
      const bb = st.diff ? barBounds(i) : null;
      if (bb) {
        const { x, y, w, h: height } = bb.visualBounds;
        marks.push(box('bar-warn-bg', x, y - 4, w, height + 8));
        // Right-aligned above the staff, clear of the bar number and tempo mark on the left.
        const warn = box('bar-warn', x, y - 20, w - 4, 16);
        warn.append(h('span', {}, `⚠ ${describeTicks(st.diff)} ${st.diff < 0 ? 'short' : 'too long'}`));
        marks.push(warn);
      }
    }
    const bb = barBounds(cursor.bar);
    const beat = bb?.beats.find((b) => b.beat.voice.index === 0 && b.beat.index === cursor.beat);
    if (bb && beat) {
      const lines = doc.tracks[cursor.track].kind === 'drums' ? 5 : doc.tracks[cursor.track].tuning.length;
      const lineH = bb.visualBounds.h / Math.max(1, lines - 1);
      const size = Math.max(14, lineH * 0.95);
      const x = beat.onNotesX || beat.visualBounds.x + beat.visualBounds.w / 2;
      marks.push(box('beat-col', x - size / 2 - 3, bb.visualBounds.y - lineH / 2, size + 6, bb.visualBounds.h + lineH));
      if (doc.tracks[cursor.track].kind === 'drums') {
        // A drum staff has no line per drum: name the drum above the beat instead.
        const label = box('caret-label', x - 40, bb.visualBounds.y - 22, 80, 16);
        label.append(h('span', {}, laneName(doc.tracks[cursor.track], cursor.string)));
        marks.push(label);
        revealInViewport(bb.visualBounds.y);
      } else {
        const y = stringY(bb, cursor.string);
        marks.push(box('caret', x - size / 2, y - size / 2, size, size));
        revealInViewport(y);
      }
    }
    overlay.replaceChildren(...marks);
  }

  function box(cls: string, x: number, y: number, w: number, hgt: number): HTMLElement {
    const el = h(`div.${cls}`);
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hgt}px` });
    return el;
  }

  function revealInViewport(y: number): void {
    const top = viewport.scrollTop;
    const view = viewport.clientHeight;
    if (y < top + 40 || y > top + view - 60) viewport.scrollTo({ top: Math.max(0, y - view / 3), behavior: 'smooth' });
  }

  // ---------- mouse ----------
  stack.addEventListener('mousedown', (e) => {
    const lookup = at.boundsLookup;
    if (!lookup || e.button !== 0) return;
    const rect = stack.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const beat = lookup.getBeatAtPos(x, y);
    if (!beat || beat.voice.index !== 0) return;
    const bar = beat.voice.bar.index;
    const bb = barBounds(bar);
    let string = cursor.string;
    if (bb && doc.tracks[cursor.track].kind !== 'drums') {
      const strings = doc.tracks[cursor.track].tuning.length;
      const step = bb.visualBounds.h / Math.max(1, strings - 1);
      string = Math.round((y - bb.visualBounds.y) / step) + 1;
    }
    if (e.shiftKey) selectAnchor ??= cursor.bar;
    else selectAnchor = null;
    lastDigit = null;
    apply({ doc, cursor: { ...cursor, bar, beat: beat.index, string }, changedBar: -1 });
  });

  // ---------- keyboard ----------
  let lastDigit: { at: number; where: string; value: number } | null = null;

  function typeDigit(d: number): void {
    const where = `${cursor.track}:${cursor.bar}:${cursor.beat}:${cursor.string}`;
    let fret = d;
    if (lastDigit && lastDigit.where === where && performance.now() - lastDigit.at < TWO_DIGIT_MS && lastDigit.value * 10 + d <= cmd.MAX_FRET && lastDigit.value > 0) {
      fret = lastDigit.value * 10 + d;
      lastDigit = null;
    } else {
      lastDigit = { at: performance.now(), where, value: d };
    }
    apply(cmd.typeFret(doc, cursor, fret, entry), { audition: true });
  }

  function pickDuration(d: DurationValue): void {
    entry = { ...entry, duration: d };
    if (beatAtCursor()?.notes.length) apply(cmd.setDuration(doc, cursor, d));
    else drawToolbar();
  }

  function stepDuration(dir: 1 | -1): void {
    const i = DURATIONS.indexOf(entry.duration);
    const next = DURATIONS[Math.min(DURATIONS.length - 1, Math.max(0, i + dir))];
    pickDuration(next);
  }

  function toggleEntry(which: 'dotted' | 'triplet'): void {
    entry = { ...entry, [which]: !entry[which] };
    if (!entry[which]) delete entry[which];
    if (beatAtCursor()?.notes.length) apply(which === 'dotted' ? cmd.toggleDotted(doc, cursor) : cmd.toggleTriplet(doc, cursor));
    else drawToolbar();
  }

  function copySelection(): void {
    const r = selection();
    clipboard = cmd.copyBars(doc, r);
    toast(r.from === r.to ? `Copied bar ${r.from + 1}` : `Copied bars ${r.from + 1}–${r.to + 1}`);
  }

  function paste(): void {
    const r = selection();
    selectAnchor = null;
    apply(cmd.pasteBars(doc, { ...cursor, bar: r.to }, clipboard));
  }

  function deleteSelectedBars(): void {
    const r = selection();
    selectAnchor = null;
    apply(cmd.deleteBars(doc, cursor, r));
  }

  /** A dialog, not prompt(): Electron doesn't support window.prompt. */
  function editSection(): void {
    const name = h('input', { value: doc.bars[cursor.bar].section ?? '', placeholder: 'Intro, Verse, Chorus…' });
    dialogShell(`Section at bar ${cursor.bar + 1}`, [h('label', {}, 'Name (empty removes it)', name)], () => {
      apply(cmd.setSection(doc, cursor, name.value));
      return true;
    });
    name.select();
  }

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, dialog') || document.querySelector('dialog[open]')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    let handled = true;
    if (/^[0-9]$/.test(key) && !ctrl && !e.altKey) typeDigit(Number(key));
    else if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const dir = key === 'ArrowRight' ? 1 : -1;
      lastDigit = null;
      if (e.shiftKey) {
        selectAnchor ??= cursor.bar;
        apply(cmd.moveBar(doc, cursor, dir));
      } else {
        if (!ctrl) selectAnchor = null;
        apply(ctrl ? cmd.moveBar(doc, cursor, dir) : cmd.moveBeat(doc, cursor, dir));
      }
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      lastDigit = null;
      apply(cmd.moveString(doc, cursor, key === 'ArrowUp' ? -1 : 1));
    } else if (key === 'Home' || key === 'End') {
      const beats = doc.bars[cursor.bar].tracks[cursor.track].length;
      apply({ doc, cursor: { ...cursor, beat: key === 'Home' ? 0 : beats - 1 }, changedBar: -1 });
    } else if (ctrl && (key === 'z' || key === 'Z')) {
      restore(e.shiftKey ? history.redo({ doc, cursor }) : history.undo({ doc, cursor }));
    } else if (ctrl && (key === 'y' || key === 'Y')) restore(history.redo({ doc, cursor }));
    else if (ctrl && (key === 'c' || key === 'C')) copySelection();
    else if (ctrl && (key === 'x' || key === 'X')) {
      copySelection();
      deleteSelectedBars();
    } else if (ctrl && (key === 'v' || key === 'V')) paste();
    else if (ctrl && (key === 'Delete' || key === 'Backspace')) deleteSelectedBars();
    else if (ctrl || e.altKey) handled = false;
    else if (key === 'Delete' || key === 'Backspace') apply(cmd.deleteAtCursor(doc, cursor));
    else if (key === 'Insert' || key === 'i' || key === 'I') apply(cmd.insertBeat(doc, cursor, entry));
    else if (key === '+' || key === '=') stepDuration(1);
    else if (key === '-' || key === '_') stepDuration(-1);
    else if (key === '.') toggleEntry('dotted');
    else if (key === 'T') toggleEntry('triplet');
    else if (key === 'r' || key === 'R') apply(cmd.makeRest(doc, cursor));
    else if (FLAG_KEYS[key]) apply(cmd.toggleNoteFlag(doc, cursor, FLAG_KEYS[key]));
    else if (key === ' ') playFromCursor();
    else if (key === 'Escape') {
      selectAnchor = null;
      afterChange(-1);
    } else if (key === '?') showHelp();
    else handled = false;
    if (handled) {
      e.preventDefault();
      // The metronome panel listens for M and T on the window too; this key was ours.
      e.stopPropagation();
    }
  };
  window.addEventListener('keydown', onKey, true);
  cleanups.push(() => window.removeEventListener('keydown', onKey, true));

  // ---------- playback ----------
  /** A pause right after play waits for alphaTab's audio output to have started (PLAY_STARTUP_MS). */
  function pauseSafely(): void {
    window.clearTimeout(pauseTimer);
    const wait = playStartedAt + PLAY_STARTUP_MS - performance.now();
    if (wait > 0) pauseTimer = window.setTimeout(() => at.pause(), wait);
    else at.pause();
  }

  function playFromCursor(): void {
    if (at.playerState === alphaTab.synth.PlayerState.Playing) {
      pauseSafely();
      return;
    }
    playStartedAt = performance.now();
    const s = current;
    const beat = s?.tracks[cursor.track]?.staves[0]?.bars[cursor.bar]?.voices[0]?.beats[cursor.beat];
    if (beat && at.tickCache) at.tickPosition = at.tickCache.getBeatStart(beat);
    applyLoop();
    at.play();
  }

  function applyLoop(): void {
    const on = loopBtn.classList.contains('active');
    at.isLooping = on;
    const s = current;
    if (!on || !s || !at.tickCache) {
      at.playbackRange = null;
      return;
    }
    const r = selection();
    const range = new alphaTab.synth.PlaybackRange();
    range.startTick = at.tickCache.getMasterBar(s.masterBars[r.from]).start;
    range.endTick = at.tickCache.getMasterBar(s.masterBars[r.to]).end;
    at.playbackRange = range;
  }

  playBtn.onclick = () => playFromCursor();
  stopBtn.onclick = () => {
    window.clearTimeout(pauseTimer);
    const wait = playStartedAt + PLAY_STARTUP_MS - performance.now();
    if (wait > 0) pauseTimer = window.setTimeout(() => at.stop(), wait);
    else at.stop();
  };
  loopBtn.onclick = () => {
    loopBtn.classList.toggle('active');
    applyLoop();
  };
  speedSel.onchange = () => (at.playbackSpeed = Number(speedSel.value));
  zoomSel.onchange = () => {
    at.settings.display.scale = Number(zoomSel.value);
    at.updateSettings();
    at.render();
  };
  tsSel.onchange = () => {
    const [n, d] = tsSel.value.split('/').map(Number) as [number, number];
    apply(cmd.setTimeSignature(doc, cursor, [n, d]));
  };
  tempoInput.onchange = () => {
    const bpm = Number(tempoInput.value);
    if (cursor.bar > 0 && bpm === tempoAt(cursor.bar - 1)) apply(cmd.setBarTempo(doc, cursor, null));
    else if (bpm) apply(cmd.setBarTempo(doc, cursor, bpm));
  };
  titleEl.onclick = () => openSongInfoDialog();

  // ---------- dialogs ----------
  function dialogShell(title: string, body: HTMLElement[], onSubmit: () => boolean | Promise<boolean>, extra: HTMLElement[] = []): void {
    const status = h('p.form-status');
    const dialog = h('dialog.song-dialog');
    const form = h(
      'form',
      {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          try {
            if (await onSubmit()) dialog.close();
          } catch (err) {
            status.textContent = (err as Error).message;
            status.classList.add('error');
          }
        },
      },
      h('h2', {}, title),
      ...body,
      status,
      h('div.dialog-actions', {}, ...extra, h('span.spacer'), h('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'), h('button.primary', { type: 'submit' }, 'OK')),
    );
    dialog.append(form);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  function openSongInfoDialog(): void {
    const title = h('input', { value: doc.title, required: true });
    const artist = h('input', { value: doc.artist });
    const tempo = h('input', { type: 'number', min: 20, max: 400, value: doc.tempo });
    dialogShell('Song', [h('label', {}, 'Title', title), h('label', {}, 'Artist', artist), h('label', {}, 'Tempo at the start (BPM)', tempo)], async () => {
      apply(cmd.setSongInfo(doc, cursor, { title: title.value, artist: artist.value, tempo: Number(tempo.value) }));
      // The library shows its own copy of the title and artist.
      song = await api.updateSong(song.id, { title: doc.title, artist: doc.artist });
      return true;
    });
  }

  function openTrackDialog(index: number | null): void {
    const existing = index === null ? null : doc.tracks[index];
    let kind: TrackKind = existing?.kind ?? 'guitar';
    const name = h('input', { value: existing?.name ?? '', placeholder: 'Guitar 2' });
    const kindSel = h('select', { disabled: !!existing }, h('option', { value: 'guitar', selected: kind === 'guitar' }, 'Guitar'), h('option', { value: 'bass', selected: kind === 'bass' }, 'Bass'), h('option', { value: 'drums', selected: kind === 'drums' }, 'Drums'));
    let tuning = tuningField(kind, existing?.tuning);
    let sound = soundSelect(kind, existing?.sound);
    const tuningHost = h('label', {}, 'Tuning', tuning.el);
    const soundHost = h('label', {}, 'Sound', sound);
    kindSel.onchange = () => {
      kind = kindSel.value as TrackKind;
      tuning = tuningField(kind);
      sound = soundSelect(kind);
      tuningHost.replaceChildren('Tuning', tuning.el);
      soundHost.replaceChildren('Sound', sound);
    };
    const remove =
      index !== null && doc.tracks.length > 1
        ? h(
            'button.danger',
            {
              type: 'button',
              onclick: (e: Event) => {
                if (!confirm(`Remove the track "${existing!.name}" and everything on it?`)) return;
                (e.target as HTMLElement).closest('dialog')?.close();
                renderedTrack = -1;
                apply(cmd.removeTrack(doc, cursor, index));
              },
            },
            'Remove track',
          )
        : null;
    dialogShell(
      existing ? 'Track settings' : 'Add a track',
      [h('label', {}, 'Name', name), h('label', {}, 'Instrument', kindSel), tuningHost, soundHost, h('small.hint', {}, 'Retuning keeps the frets you wrote, so the notes sound in the new tuning.')],
      () => {
        const t = tuning.value();
        if (!t) throw new Error('Type the tuning as note names, lowest string first (4 to 8 strings).');
        if (existing && index !== null) {
          renderedTrack = -1;
          apply(cmd.updateTrack(doc, cursor, index, { name: name.value, sound: sound.value, tuning: t }));
        } else {
          const track: DocTrack = { name: name.value.trim() || (kind === 'bass' ? 'Bass' : kind === 'drums' ? 'Drums' : `Guitar ${doc.tracks.filter((x) => x.kind === 'guitar').length + 1}`), kind, sound: sound.value, tuning: t };
          apply(cmd.addTrack(doc, cursor, track));
        }
        return true;
      },
      remove ? [remove] : [],
    );
  }

  function showHelp(): void {
    const dialog = h(
      'dialog.song-dialog',
      {},
      h(
        'div.cloud-inner',
        {},
        h('h2', {}, 'Keyboard'),
        h('table.keys', {}, ...SHORTCUTS.map(([k, what]) => h('tr', {}, h('th', {}, k), h('td', {}, what)))),
        h('p.hint', {}, 'Bars fill themselves with rests: a note takes the place of a rest, and a longer note uses the rests after it. A bar that still doesn\'t add up gets a ⚠.'),
        h('div.dialog-actions', {}, h('button.primary', { type: 'button', onclick: () => dialog.close() }, 'Got it')),
      ),
    );
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  function exportGp(): void {
    try {
      const bytes = new alphaTab.exporter.Gp7Exporter().export(parseTex(docToTex(doc)), at.settings);
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }));
      const a = h('a', { href: url, download: `${doc.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'song'}.gp` });
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast(`Export failed: ${(err as Error).message}`, 'error');
    }
  }

  // ---------- songwriting assistant ----------
  // With bars selected (Shift + arrows or Shift + click) it improves them; otherwise it writes a new
  // riff from the prompt at the cursor bar, or after it when that bar already has notes. The result
  // is a normal edit, so Ctrl+Z takes it back.
  let aiBusy: AbortController | null = null;
  /** The last riff put in the song, for "Try again" and "Undo". `doc` is the document right after it. */
  let lastAi: { request: RiffRequest; target: RiffTarget; cursor: Cursor; doc: SongDoc } | null = null;
  let aiShownMode = '';

  /** Where a new riff goes: the cursor bar if it's still empty on this track, else the bar after it. */
  function generateAt(): number {
    const filled = doc.bars[cursor.bar].tracks[cursor.track]?.some((b) => b.notes.length);
    return filled ? cursor.bar + 1 : cursor.bar;
  }

  function drawAssistant(): void {
    const improving = selectAnchor !== null;
    const r = selection();
    const count = r.to - r.from + 1;
    const mode = improving ? 'improve' : 'generate';
    aiMode.textContent = improving
      ? `Improve bar${count === 1 ? '' : 's'} ${r.from + 1}${count === 1 ? '' : `–${r.to + 1}`} of ${doc.tracks[cursor.track].name}, or ask for other parts to go with them.`
      : `Write a new riff from bar ${generateAt() + 1}. Ask for a bass line, drums or a second guitar too. Select bars (Shift + ← →) to improve them instead.`;
    aiBarsLabel.classList.toggle('hidden', improving);
    aiGo.textContent = aiBusy ? '■ Stop' : improving ? '✨ Improve' : '✨ Write';
    aiGo.disabled = !aiBusy && improving && count > MAX_RIFF_BARS;
    if (aiGo.disabled) aiMode.textContent = `Select at most ${MAX_RIFF_BARS} bars to improve.`;
    aiPrompt.disabled = !!aiBusy;
    const ideasKey = `${mode}:${doc.tracks[cursor.track].kind}`;
    if (ideasKey === aiShownMode) return;
    aiShownMode = ideasKey;
    aiPrompt.placeholder = improving ? 'What should change? (optional) e.g. "more syncopation"' : 'Describe the riff, e.g. "a funky riff in E minor"';
    const ideas = improving ? IMPROVE_IDEAS : GENERATE_IDEAS[doc.tracks[cursor.track].kind];
    aiIdeas.replaceChildren(...ideas.map((idea) => h('button.chip', { type: 'button', onclick: () => (aiPrompt.value = idea) }, idea)));
  }

  function showAiResult(...children: (HTMLElement | string)[]): void {
    aiResult.replaceChildren(...children);
    aiResult.classList.toggle('hidden', !children.length);
  }

  async function runAssistant(again = false): Promise<void> {
    if (aiBusy) {
      aiBusy.abort();
      return;
    }
    let request: RiffRequest;
    let target: RiffTarget;
    let from: Cursor;
    if (again && lastAi) {
      // Take the previous attempt out first, so the new one starts from the same song.
      if (doc === lastAi.doc) restore(history.undo({ doc, cursor }));
      ({ request, target, cursor: from } = lastAi);
    } else {
      from = cursor;
      const track = cursor.track;
      const prompt = aiPrompt.value.trim();
      if (selectAnchor !== null) {
        const range = selection();
        target = { replace: range };
        request = buildRiffRequest(doc, track, { mode: 'improve', range, prompt });
      } else {
        const at = generateAt();
        target = { at };
        request = buildRiffRequest(doc, track, { mode: 'generate', at, bars: Number(aiBars.value), prompt });
      }
    }
    const problem = riffRequestProblem(request);
    if (problem) {
      showAiResult(h('p.hint.warn', {}, problem));
      if (!request.prompt) aiPrompt.focus();
      return;
    }
    const controller = new AbortController();
    aiBusy = controller;
    drawAssistant();
    showAiResult(h('p.ai-thinking', {}, h('span.spinner.small'), request.mode === 'improve' ? 'Reworking your riff…' : 'Writing a riff…'));
    try {
      const { riff } = await api.riffAssistant(request, controller.signal);
      const result = riffFromAnswer(riff, doc, target);
      const e = applyRiff(doc, from, target, result);
      if (e.doc.tracks.length !== doc.tracks.length || e.cursor.track !== cursor.track) renderedTrack = -1;
      apply(e);
      // Select the new bars: "Improve" works on them next, and the loop plays them.
      selectAnchor = e.range.to;
      lastAi = { request, target, cursor: from, doc };
      afterChange(-1);
      const where = e.range.from === e.range.to ? `bar ${e.range.from + 1}` : `bars ${e.range.from + 1}–${e.range.to + 1}`;
      const parts = e.written.length > 1 || e.written.some((w) => w.added) ? `${describeWritten(e.written, doc)}, ` : '';
      showAiResult(
        h('p', {}, result.explanation || (request.mode === 'improve' ? 'Here is a reworked version.' : 'Here is a new riff.')),
        ...result.fixes.map((f) => h('p.hint', {}, f)),
        h('p.hint', {}, `Now in ${parts}${where}. Ctrl+Z takes it back.`),
        h(
          'div.ai-row',
          {},
          h('button', { type: 'button', title: 'Play the new bars', onclick: () => playFromCursor() }, '▶ Play'),
          h('button', { type: 'button', title: 'Ask again with the same words', onclick: () => void runAssistant(true) }, '⟳ Try again'),
          h('button', { type: 'button', title: 'Take the riff out again', onclick: () => undoAssistant() }, '↶ Undo'),
        ),
      );
    } catch (err) {
      showAiResult(h('p.hint.warn', {}, controller.signal.aborted ? 'Stopped.' : (err as Error).message));
    } finally {
      aiBusy = null;
      drawAssistant();
    }
  }

  function undoAssistant(): void {
    if (lastAi && doc === lastAi.doc) {
      restore(history.undo({ doc, cursor }));
      selectAnchor = null;
      afterChange(-1);
      showAiResult();
    } else toast('The song changed since then. Use Ctrl+Z to step back.');
  }

  aiGo.onclick = () => void runAssistant();
  aiPrompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void runAssistant();
    } else if (e.key === 'Escape') aiPrompt.blur();
  });
  cleanups.push(() => aiBusy?.abort());

  // ---------- go ----------
  render(0);
  afterChange(-1);
  viewport.focus();
  return () => cleanups.reverse().forEach((c) => c());
}
