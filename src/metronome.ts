/**
 * A standalone metronome (Web Audio, look-ahead scheduling) with a floating panel. It works on
 * every page and keeps running while you switch songs. In the player it can pick up the song's
 * tempo and time signature. The timing maths lives in shared/metronome.ts.
 */
import {
  MAX_BPM,
  MIN_BPM,
  clampBpm,
  clicksInWindow,
  normalizeSettings,
  tapTempo,
  type Click,
  type MetronomeSettings,
  type Subdivision,
} from '../shared/metronome.ts';
import { h } from './dom.ts';

const STORAGE_KEY = 'fretlane.metronome';
const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;

function loadSettings(): MetronomeSettings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return normalizeSettings(null);
  }
}

function saveSettings(s: MetronomeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* private mode or storage disabled: settings just are not remembered */
  }
}

class MetronomeEngine {
  settings = loadSettings();
  running = false;
  /** Clicks scheduled since the page loaded (read by the browser test). */
  scheduled = 0;
  onClick: ((c: Click) => void) | null = null;
  onStateChange: (() => void) | null = null;
  private ctx: AudioContext | null = null;
  private timer = 0;
  private start = 0;
  private next = 0;

  toggle(): void {
    if (this.running) this.stop();
    else this.play();
  }

  play(): void {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    this.running = true;
    this.restartClock();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
    this.onStateChange?.();
  }

  stop(): void {
    this.running = false;
    window.clearInterval(this.timer);
    this.onStateChange?.();
  }

  update(patch: Partial<MetronomeSettings>): void {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    saveSettings(this.settings);
    // Tempo or meter changed: start counting again from the next click so the bar stays aligned.
    if (this.running) this.restartClock();
  }

  private restartClock(): void {
    this.start = (this.ctx?.currentTime ?? 0) + 0.05;
    this.next = 0;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const now = ctx.currentTime;
    const clicks = clicksInWindow(this.start, this.next, now, now + LOOKAHEAD_S, this.settings);
    for (const c of clicks) {
      this.sound(ctx, c);
      this.next = c.index + 1;
      this.scheduled++;
      // Light the beat indicator when the click is heard, not when it is scheduled.
      window.setTimeout(() => this.running && this.onClick?.(c), Math.max(0, (c.time - now) * 1000));
    }
  }

  private sound(ctx: AudioContext, c: Click): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = c.kind === 'sub' ? 'sine' : 'square';
    osc.frequency.value = c.kind === 'accent' ? 1760 : c.kind === 'beat' ? 1320 : 880;
    const peak = this.settings.volume * (c.kind === 'sub' ? 0.25 : c.kind === 'accent' ? 0.6 : 0.4);
    gain.gain.setValueAtTime(0.0001, c.time);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), c.time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.time + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(c.time);
    osc.stop(c.time + 0.06);
  }
}

export const metronome = new MetronomeEngine();
(window as unknown as { fretlaneMetronome: MetronomeEngine }).fretlaneMetronome = metronome;

/** Tempo and meter of the open song, offered as a one-click preset in the panel. */
let songContext: { bpm: number; beatsPerBar: number; label: string } | null = null;
let panel: HTMLElement | null = null;
let redraw: (() => void) | null = null;
const buttons = new Set<HTMLButtonElement>();

export function setMetronomeSongContext(ctx: typeof songContext): void {
  songContext = ctx;
  redraw?.();
}

function syncButtons(): void {
  for (const b of buttons) {
    if (!b.isConnected) buttons.delete(b);
    b.classList.toggle('active', metronome.running);
    b.classList.toggle('open', !!panel);
  }
}

/** A toolbar button that opens the metronome panel. */
export function metronomeButton(): HTMLButtonElement {
  const b = h('button.metronome-btn', { title: 'Metronome (M)', onclick: () => toggleMetronomePanel() }, '♩ Metronome');
  buttons.add(b);
  syncButtons();
  return b;
}

export function toggleMetronomePanel(show = !panel): void {
  if (!show) {
    panel?.remove();
    panel = null;
    redraw = null;
    syncButtons();
    return;
  }
  if (panel) return;
  panel = buildPanel();
  document.body.append(panel);
  syncButtons();
}

function buildPanel(): HTMLElement {
  const s = () => metronome.settings;
  const bpmOut = h('output.bpm-value', {}, String(s().bpm));
  const slider = h('input.bpm-slider', {
    type: 'range',
    min: MIN_BPM,
    max: MAX_BPM,
    value: s().bpm,
    'aria-label': 'Tempo',
    oninput: () => setBpm(Number(slider.value)),
  });
  const setBpm = (bpm: number) => {
    metronome.update({ bpm: clampBpm(bpm) });
    draw();
  };
  const taps: number[] = [];
  const tapBtn = h(
    'button.tap',
    {
      title: 'Tap the beat a few times (T)',
      onclick: () => {
        taps.push(performance.now());
        if (taps.length > 16) taps.shift();
        const bpm = tapTempo(taps);
        if (bpm) setBpm(bpm);
      },
    },
    'Tap',
  );
  const beatsSel = h(
    'select',
    {
      title: 'Beats per bar',
      onchange: () => {
        metronome.update({ beatsPerBar: Number(beatsSel.value) });
        draw();
      },
    },
    ...Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === s().beatsPerBar }, `${i + 1}`)),
  );
  const subSel = h(
    'select',
    {
      title: 'Clicks per beat',
      onchange: () => {
        metronome.update({ subdivision: Number(subSel.value) as Subdivision });
        draw();
      },
    },
    ...([
      [1, '♩ Quarters'],
      [2, '♫ Eighths'],
      [3, '3 Triplets'],
      [4, '♬ Sixteenths'],
    ] as const).map(([v, label]) => h('option', { value: v, selected: v === s().subdivision }, label)),
  );
  const accent = h('input', { type: 'checkbox', checked: s().accent, onchange: () => metronome.update({ accent: accent.checked }) });
  const volume = h('input', {
    type: 'range',
    min: 0,
    max: 1,
    step: 0.05,
    value: s().volume,
    'aria-label': 'Volume',
    oninput: () => metronome.update({ volume: Number(volume.value) }),
  });
  const dots = h('div.beat-dots');
  const startBtn = h('button.primary.metronome-start', { onclick: () => metronome.toggle() });
  const songRow = h('div.row.song-tempo');

  function draw(): void {
    bpmOut.textContent = String(s().bpm);
    slider.value = String(s().bpm);
    beatsSel.value = String(s().beatsPerBar);
    subSel.value = String(s().subdivision);
    startBtn.textContent = metronome.running ? '■ Stop' : '▶ Start';
    dots.replaceChildren(...Array.from({ length: s().beatsPerBar }, (_, i) => h('span.dot', { class: i === 0 && s().accent ? 'first' : '' })));
    songRow.replaceChildren(
      ...(songContext
        ? [
            h(
              'button',
              {
                title: 'Use the tempo and time signature of this song',
                onclick: () => {
                  metronome.update({ bpm: songContext!.bpm, beatsPerBar: songContext!.beatsPerBar });
                  draw();
                },
              },
              `Use song tempo: ${songContext.label}`,
            ),
          ]
        : []),
    );
    syncButtons();
  }

  metronome.onClick = (c) => {
    if (c.kind === 'sub') return;
    dots.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i === c.beat));
  };
  metronome.onStateChange = () => {
    draw();
    if (!metronome.running) dots.querySelectorAll('.dot').forEach((d) => d.classList.remove('on'));
  };
  redraw = draw;

  const el = h(
    'aside.metronome-panel',
    { role: 'dialog', 'aria-label': 'Metronome' },
    h('div.sync-head', {}, h('h3', {}, 'Metronome'), h('button.icon', { title: 'Close', onclick: () => toggleMetronomePanel(false) }, '✕')),
    h(
      'div.bpm-row',
      {},
      h('button.icon.big', { title: 'Slower', onclick: () => setBpm(s().bpm - 1) }, '−'),
      h('div.bpm-display', {}, bpmOut, h('small', {}, 'BPM')),
      h('button.icon.big', { title: 'Faster', onclick: () => setBpm(s().bpm + 1) }, '+'),
    ),
    slider,
    dots,
    h('div.row', {}, startBtn, tapBtn),
    h('div.row', {}, h('label.inline', {}, 'Beats', beatsSel), h('label.inline', {}, subSel)),
    h('div.row', {}, h('label.inline', {}, accent, 'Accent beat 1'), h('label.inline', {}, 'Volume', volume)),
    songRow,
  );
  draw();
  return el;
}

// M toggles the panel, T taps the tempo while it is open (outside text fields and dialogs).
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, textarea, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'm' || e.key === 'M') toggleMetronomePanel();
  else if ((e.key === 't' || e.key === 'T') && panel && !document.querySelector('.sync-panel:not(.hidden)')) {
    panel.querySelector<HTMLButtonElement>('button.tap')?.click();
  }
});
