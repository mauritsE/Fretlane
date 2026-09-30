import * as alphaTab from '@coderline/alphatab';
import type { Song, SyncPoint } from '../shared/types.ts';
import { normalizeSyncPoints, shiftSyncPoints, toFlatSyncPoints, upsertSyncPoint } from '../shared/sync.ts';
import { APP_NAME } from '../shared/brand.ts';
import { api } from './api.ts';
import { formatTime, h, toast } from './dom.ts';
import { openSongDialog } from './libraryView.ts';
import { YouTubeVideo, YT_STATE } from './youtube.ts';

const QUARTER_TICKS = 960;
const YT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5];
const SYNTH_RATES = [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

type Cleanup = () => void;

/** Renders the player page and returns a cleanup function for when the user navigates away. */
export async function renderPlayer(root: HTMLElement, songId: string): Promise<Cleanup> {
  let song: Song;
  let tab: Uint8Array;
  try {
    [song, tab] = await Promise.all([api.getSong(songId), api.getTab(songId)]);
  } catch (err) {
    root.replaceChildren(h('main.library', {}, h('p.empty', {}, `Could not open song: ${(err as Error).message}. `, h('a', { href: '#/' }, 'Back to library'))));
    return () => {};
  }

  const useVideo = !!song.youtubeId;
  const cleanups: Cleanup[] = [];
  let video: YouTubeVideo | null = null;
  let currentBar = 0;
  let tapMode = false;
  let tapNextBar = 0;

  // ---------- layout ----------
  const titleEl = h('div.song-heading', {}, h('strong', {}, song.title), h('span', {}, ` — ${song.artist}`));
  const tabHost = h('div.at-host');
  const viewport = h('div.at-viewport', {}, tabHost);
  const overlay = h('div.at-overlay', {}, h('div.spinner'), h('span', {}, 'Loading tab…'));
  const trackList = h('ul.track-list');
  const videoBox = h('div.video-box');
  const videoPanel = h(
    'div.video-panel',
    { class: useVideo ? '' : 'hidden' },
    h(
      'div.video-toolbar',
      {},
      h('span', {}, 'YouTube'),
      h('span.spacer'),
      ...(['S', 'M', 'L'] as const).map((sz) =>
        h('button.icon', { title: `Size ${sz}`, onclick: () => (videoPanel.dataset.size = sz) }, sz),
      ),
      h('button.icon', { title: 'Collapse', onclick: () => videoPanel.classList.toggle('collapsed') }, '▾'),
    ),
    videoBox,
  );
  videoPanel.dataset.size = 'M';

  const playBtn = h('button.play', { title: 'Play / pause (Space)' }, '▶');
  const stopBtn = h('button.icon', { title: 'Back to start' }, '⏮');
  const timeEl = h('span.time', {}, '0:00.00');
  const barEl = h('span.bar-pos', {}, 'Bar 1');
  const speedSel = h(
    'select',
    { title: 'Playback speed' },
    ...(useVideo ? YT_RATES : SYNTH_RATES).map((r) => h('option', { value: r, selected: r === 1 }, `${Math.round(r * 100)}%`)),
  );
  const loopBtn = h('button.toggle', { title: 'Loop the selected range (drag across the tab to select). Shortcut: L' }, '⟲ Loop');
  const metroBtn = h('button.toggle', { title: 'Metronome', disabled: useVideo }, '♩ Metronome');
  const countInBtn = h('button.toggle', { title: 'Count-in before playing', disabled: useVideo }, '1-2-3-4');
  const zoomSel = h(
    'select',
    { title: 'Zoom' },
    ...[0.6, 0.75, 0.9, 1, 1.2, 1.4].map((z) => h('option', { value: z, selected: z === 0.9 }, `${Math.round(z * 100)}%`)),
  );
  const layoutSel = h(
    'select',
    { title: 'Layout' },
    h('option', { value: 'page' }, 'Page'),
    h('option', { value: 'horizontal' }, 'Horizontal'),
  );
  const staveSel = h(
    'select',
    { title: 'Notation' },
    h('option', { value: String(alphaTab.StaveProfile.Tab) }, 'Tab'),
    h('option', { value: String(alphaTab.StaveProfile.ScoreTab) }, 'Score + Tab'),
    h('option', { value: String(alphaTab.StaveProfile.Score) }, 'Score'),
  );
  const syncBtn = h('button.toggle', { title: 'Align the tab with the video', disabled: !useVideo }, '⇆ Sync');

  const syncPanel = h('aside.sync-panel.hidden');

  root.replaceChildren(
    h(
      'header.topbar',
      {},
      h('a.back', { href: '#/', title: 'Library' }, '←'),
      h('a.brand', { href: '#/' }, h('img.logo', { src: '/icon.svg', alt: APP_NAME })),
      titleEl,
      h('span.spacer'),
      h(
        'button',
        {
          onclick: () =>
            openSongDialog(song, async (s) => {
              const videoChanged = s.youtubeId !== song.youtubeId;
              song = s;
              titleEl.replaceChildren(h('strong', {}, s.title), h('span', {}, ` — ${s.artist}`));
              if (videoChanged) location.reload();
            }),
        },
        'Edit',
      ),
    ),
    h(
      'div.player-layout',
      {},
      h('aside.sidebar', {}, h('h3', {}, 'Tracks'), trackList),
      h('section.score-area', {}, viewport, overlay, videoPanel, syncPanel),
    ),
    h(
      'footer.controls',
      {},
      stopBtn,
      playBtn,
      timeEl,
      barEl,
      h('span.sep'),
      h('label.inline', {}, 'Speed', speedSel),
      loopBtn,
      metroBtn,
      countInBtn,
      h('span.spacer'),
      syncBtn,
      h('label.inline', {}, 'View', staveSel),
      layoutSel,
      zoomSel,
    ),
  );

  // ---------- alphaTab ----------
  const settings: alphaTab.json.SettingsJson = {
    core: {
      // Explicit, because Vite's dependency pre-bundling breaks alphaTab's auto-detection of its assets.
      fontDirectory: `${import.meta.env.BASE_URL}font/`,
      logLevel: import.meta.env.DEV ? alphaTab.LogLevel.Info : alphaTab.LogLevel.Warning },
    display: { scale: 0.9, layoutMode: alphaTab.LayoutMode.Page, staveProfile: alphaTab.StaveProfile.Tab },
    player: {
      enablePlayer: true,
      playerMode: useVideo ? alphaTab.PlayerMode.EnabledExternalMedia : alphaTab.PlayerMode.EnabledSynthesizer,
      soundFont: `${import.meta.env.BASE_URL}soundfont/sonivox.sf2`,
      scrollElement: viewport,
      enableCursor: true,
      enableAnimatedBeatCursor: true,
      enableUserInteraction: true,
      scrollMode: alphaTab.ScrollMode.Continuous,
    },
  };
  const at = new alphaTab.AlphaTabApi(tabHost, settings);
  cleanups.push(() => at.destroy());
  // Handy for debugging from the devtools console.
  (window as unknown as { fretlane: unknown }).fretlane = { at, get video() { return video; }, get song() { return song; } };

  at.error.on((e) => {
    overlay.classList.add('hidden');
    toast(`Tab error: ${e.message}`, 'error');
  });
  at.renderStarted.on(() => overlay.classList.remove('hidden'));
  at.renderFinished.on(() => overlay.classList.add('hidden'));

  at.scoreLoaded.on((score) => {
    applySyncPoints(score);
    drawTracks();
  });

  at.playerStateChanged.on((e) => {
    playBtn.textContent = e.state === alphaTab.synth.PlayerState.Playing ? '⏸' : '▶';
  });
  at.playerPositionChanged.on((e) => {
    if (!useVideo) timeEl.textContent = formatTime(e.currentTime / 1000);
  });
  at.playedBeatChanged.on((beat) => setCurrentBar(beat.voice.bar.masterBar.index));
  at.beatMouseDown.on((beat) => setCurrentBar(beat.voice.bar.masterBar.index));

  // ---------- YouTube <-> alphaTab bridge ----------
  if (useVideo) {
    try {
      video = await YouTubeVideo.create(videoBox, song.youtubeId, {
        onStateChange: (state) => {
          // The video is the master clock: mirror its state into alphaTab.
          if (state === YT_STATE.PLAYING) at.play();
          else if (state === YT_STATE.PAUSED) at.pause();
          else if (state === YT_STATE.ENDED) at.stop();
        },
        onError: (msg) => toast(`YouTube: ${msg}`, 'error'),
      });
      cleanups.push(() => video?.destroy());
      const v = video;
      const handler: alphaTab.synth.IExternalMediaHandler = {
        get backingTrackDuration() {
          return v.duration * 1000;
        },
        get playbackRate() {
          return Number(speedSel.value);
        },
        set playbackRate(value: number) {
          v.setRate(value);
        },
        get masterVolume() {
          return 1;
        },
        set masterVolume(value: number) {
          v.setVolume(value);
        },
        seekTo(ms: number) {
          v.seek(ms / 1000);
        },
        play() {
          v.play();
        },
        pause() {
          v.pause();
        },
      };
      const attach = () => {
        (at.player!.output as alphaTab.synth.IExternalMediaSynthOutput).handler = handler;
      };
      if (at.player) attach();
      at.playerReady.on(attach);

      // Push the video clock into alphaTab every frame.
      let raf = 0;
      let last = -1;
      const tick = () => {
        const t = v.currentTime;
        if (t !== last && at.player) {
          last = t;
          (at.player.output as alphaTab.synth.IExternalMediaSynthOutput).updatePosition(t * 1000);
          timeEl.textContent = formatTime(t);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      cleanups.push(() => cancelAnimationFrame(raf));
    } catch (err) {
      toast((err as Error).message, 'error');
      videoPanel.classList.add('hidden');
    }
  }

  // ---------- load the tab ----------
  const tracksToShow = [song.defaultTrack];
  if (song.tabFormat === 'alphatex') at.tex(new TextDecoder().decode(tab), tracksToShow);
  else at.load(tab, tracksToShow);

  // ---------- helpers ----------
  function setCurrentBar(i: number): void {
    currentBar = i;
    const total = at.score?.masterBars.length ?? 0;
    barEl.textContent = `Bar ${i + 1}${total ? ` / ${total}` : ''}`;
  }

  function barStartMs(bar: number): number {
    const score = at.score;
    if (!score) return 0;
    let ms = 0;
    let bpm = score.tempo;
    for (let i = 0; i < Math.min(bar, score.masterBars.length); i++) {
      const mb = score.masterBars[i];
      if (mb.tempoAutomations.length) bpm = mb.tempoAutomations[0].value;
      ms += (mb.calculateDuration() / QUARTER_TICKS) * (60000 / bpm);
    }
    return ms;
  }

  function applySyncPoints(score: alphaTab.model.Score): void {
    if (!useVideo) return;
    for (const mb of score.masterBars) mb.syncPoints = undefined;
    const flat = toFlatSyncPoints(song.syncPoints, barStartMs).filter((p) => p.barIndex < score.masterBars.length);
    if (flat.length) score.applyFlatSyncPoints(flat);
  }

  let saveTimer: number | undefined;
  function setSyncPoints(points: SyncPoint[], announce?: string): void {
    song.syncPoints = normalizeSyncPoints(points);
    if (at.score) {
      applySyncPoints(at.score);
      at.updateSyncPoints();
    }
    drawSyncPanel();
    if (announce) toast(announce);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      try {
        song = await api.updateSong(song.id, { syncPoints: song.syncPoints });
      } catch (err) {
        toast(`Could not save sync: ${(err as Error).message}`, 'error');
      }
    }, 400);
  }

  function drawTracks(): void {
    const score = at.score;
    if (!score) return;
    const rendered = new Set(at.tracks.map((t) => t.index));
    trackList.replaceChildren(
      ...score.tracks.map((track) => {
        const staff = track.staves[0];
        const kind = staff.isPercussion ? 'Drums' : staff.tuning.length ? `${staff.tuning.length}-string` : 'Score';
        const mute = h('button.mini', { title: 'Mute', disabled: useVideo }, 'M');
        const solo = h('button.mini', { title: 'Solo', disabled: useVideo }, 'S');
        mute.onclick = (e) => {
          e.stopPropagation();
          const on = mute.classList.toggle('active');
          at.changeTrackMute([track], on);
        };
        solo.onclick = (e) => {
          e.stopPropagation();
          const on = solo.classList.toggle('active');
          at.changeTrackSolo([track], on);
        };
        return h(
          'li',
          {
            class: rendered.has(track.index) ? 'active' : '',
            onclick: () => {
              at.renderTracks([track]);
              trackList.querySelectorAll('li').forEach((li) => li.classList.remove('active'));
              trackList.children[track.index]?.classList.add('active');
              if (track.index !== song.defaultTrack) {
                song.defaultTrack = track.index;
                void api.updateSong(song.id, { defaultTrack: track.index }).catch(() => {});
              }
            },
          },
          h('span.track-name', {}, track.name || `Track ${track.index + 1}`),
          h('small', {}, kind),
          h('span.track-buttons', {}, mute, solo),
        );
      }),
    );
    setCurrentBar(currentBar);
  }

  function drawSyncPanel(): void {
    const pts = song.syncPoints;
    const barInput = h('input', { type: 'number', min: 1, value: currentBar + 1, style: 'width:4.5em' });
    const tapInfo = tapMode
      ? h('p.tap-info', {}, `Tapping: press T on the first beat of bar ${tapNextBar + 1}. Press Esc to stop.`)
      : null;
    const children: (Node | null)[] = [
      h('div.sync-head', {}, h('h3', {}, 'Sync tab ⇆ video'), h('button.icon', { title: 'Close', onclick: () => toggleSync(false) }, '✕')),
      h(
        'p.hint',
        {},
        'Pause the video exactly on the first beat of a bar, then pin that bar to the current video time. ',
        'One pin sets the start; add more pins to follow tempo changes in the recording.',
      ),
      h(
        'div.row',
        {},
        h('label.inline', {}, 'Bar', barInput),
        h(
          'button.primary',
          {
            onclick: () => {
              const bar = Math.max(1, Math.floor(Number(barInput.value) || 1)) - 1;
              const t = +(video?.currentTime ?? 0).toFixed(3);
              setSyncPoints(upsertSyncPoint(song.syncPoints, bar, t), `Pinned bar ${bar + 1} to ${formatTime(t)}`);
            },
          },
          '📌 Pin to video time',
        ),
      ),
      h(
        'div.row',
        {},
        h(
          'button',
          {
            class: tapMode ? 'active' : '',
            title: 'Play the video and press T on the first beat of every bar',
            onclick: () => {
              tapMode = !tapMode;
              tapNextBar = Math.max(1, Math.floor(Number(barInput.value) || 1)) - 1;
              if (tapMode) video?.play();
              drawSyncPanel();
            },
          },
          tapMode ? '■ Stop tapping' : '👆 Tap along (T)',
        ),
      ),
      tapInfo,
      h(
        'div.row',
        {},
        h('span', {}, 'Shift all:'),
        ...[-0.5, -0.05, 0.05, 0.5].map((d) =>
          h('button.mini', { disabled: !pts.length, onclick: () => setSyncPoints(shiftSyncPoints(song.syncPoints, d)) }, `${d > 0 ? '+' : ''}${d}s`),
        ),
      ),
      pts.length
        ? h(
            'table.sync-table',
            {},
            h('tr', {}, h('th', {}, 'Bar'), h('th', {}, 'Video time'), h('th', {})),
            ...pts.map((p) =>
              h(
                'tr',
                {},
                h('td', {}, String(p.bar + 1)),
                h(
                  'td',
                  {},
                  h('input', {
                    type: 'number',
                    step: 0.01,
                    min: 0,
                    value: p.time.toFixed(2),
                    onchange: (e: Event) =>
                      setSyncPoints(upsertSyncPoint(song.syncPoints, p.bar, Number((e.target as HTMLInputElement).value))),
                  }),
                ),
                h(
                  'td',
                  {},
                  h('button.mini', { title: 'Jump here', onclick: () => video?.seek(p.time) }, '▶'),
                  h('button.mini.danger', { title: 'Remove', onclick: () => setSyncPoints(song.syncPoints.filter((q) => q.bar !== p.bar)) }, '✕'),
                ),
              ),
            ),
          )
        : h('p.hint', {}, 'No pins yet: bar 1 starts at 0:00 in the video.'),
      pts.length ? h('button.danger', { onclick: () => confirm('Remove all sync pins?') && setSyncPoints([], 'Sync cleared') }, 'Clear all') : null,
    ];
    syncPanel.replaceChildren(...children.filter((c): c is Node => c !== null));
  }

  function toggleSync(show = syncPanel.classList.contains('hidden')): void {
    syncPanel.classList.toggle('hidden', !show);
    syncBtn.classList.toggle('active', show);
    if (show) drawSyncPanel();
    else tapMode = false;
  }

  // ---------- controls ----------
  playBtn.onclick = () => at.playPause();
  stopBtn.onclick = () => {
    at.stop();
    if (video) {
      video.pause();
      video.seek(song.syncPoints[0]?.time ?? 0);
    }
  };
  speedSel.onchange = () => {
    at.playbackSpeed = Number(speedSel.value);
  };
  loopBtn.onclick = () => {
    at.isLooping = loopBtn.classList.toggle('active');
  };
  metroBtn.onclick = () => {
    at.metronomeVolume = metroBtn.classList.toggle('active') ? 1 : 0;
  };
  countInBtn.onclick = () => {
    at.countInVolume = countInBtn.classList.toggle('active') ? 1 : 0;
  };
  zoomSel.onchange = () => {
    at.settings.display.scale = Number(zoomSel.value);
    at.updateSettings();
    at.render();
  };
  layoutSel.onchange = () => {
    at.settings.display.layoutMode = layoutSel.value === 'horizontal' ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page;
    viewport.classList.toggle('horizontal', layoutSel.value === 'horizontal');
    at.updateSettings();
    at.render();
  };
  staveSel.onchange = () => {
    at.settings.display.staveProfile = Number(staveSel.value) as alphaTab.StaveProfile;
    at.updateSettings();
    at.render();
  };
  syncBtn.onclick = () => toggleSync();

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, dialog')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      at.playPause();
    } else if (e.key === 'l' || e.key === 'L') {
      loopBtn.click();
    } else if ((e.key === 't' || e.key === 'T') && tapMode && video) {
      const t = +video.currentTime.toFixed(3);
      const bar = tapNextBar;
      tapNextBar++;
      setSyncPoints(upsertSyncPoint(song.syncPoints, bar, t), `Bar ${bar + 1} → ${formatTime(t)}`);
    } else if (e.key === 'Escape' && tapMode) {
      tapMode = false;
      drawSyncPanel();
    }
  };
  window.addEventListener('keydown', onKey);
  cleanups.push(() => window.removeEventListener('keydown', onKey));
  cleanups.push(() => window.clearTimeout(saveTimer));

  return () => cleanups.reverse().forEach((c) => c());
}
