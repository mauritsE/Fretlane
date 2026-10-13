/**
 * Waveform of the song's audio file in the sync panel, for placing sync pins by eye: a zoomed view
 * that scrolls under a fixed playhead, plus an overview of the whole recording. Clicking the zoomed
 * view snaps to the nearest note attack (hold Alt for the exact spot). The maths is in shared/waveform.ts.
 */
import type { SyncPoint } from '../shared/types.ts';
import { computePeaks, nearestOnset, peaksInRange, viewWindow, type Peaks } from '../shared/waveform.ts';
import { h } from './dom.ts';

export interface WaveformOptions {
  /** Seconds. */
  currentTime(): number;
  pins(): SyncPoint[];
  seek(seconds: number): void;
}

const SPANS = [1, 2, 4, 8, 16, 32];
const DETAIL_HEIGHT = 96;
const OVERVIEW_HEIGHT = 28;

export class WaveformView {
  readonly el: HTMLElement;
  private readonly detail = h('canvas.wave-detail', { title: 'Click a note to move there (snaps to the attack; hold Alt for the exact spot). Scroll to zoom.' });
  private readonly overview = h('canvas.wave-overview', { title: 'The whole recording. Click to jump.' });
  private readonly status = h('span.wave-status', {}, 'Loading waveform…');
  private peaks: Peaks | null = null;
  private span = 4;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly opts: WaveformOptions,
  ) {
    const zoom = (dir: -1 | 1) => () => this.zoom(dir);
    this.el = h(
      'div.waveform',
      { 'data-state': 'idle' },
      this.detail,
      this.overview,
      h(
        'div.wave-bar',
        {},
        this.status,
        h('span.spacer'),
        h('button.mini', { type: 'button', title: 'Zoom out', 'data-zoom': 'out', onclick: zoom(1) }, '−'),
        h('button.mini', { type: 'button', title: 'Zoom in', 'data-zoom': 'in', onclick: zoom(-1) }, '+'),
      ),
    );
    this.detail.addEventListener('click', (e) => this.onDetailClick(e));
    this.overview.addEventListener('click', (e) => {
      if (!this.peaks) return;
      this.opts.seek(this.fraction(e, this.overview) * this.peaks.duration);
    });
    this.detail.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );
  }

  /** Downloads and decodes the audio once; later calls reuse the result. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      this.el.dataset.state = 'loading';
      try {
        const res = await fetch(this.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        // An offline context decodes without needing a click first, and needs no audio device.
        const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
        const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
        this.peaks = computePeaks(channels, audio.sampleRate);
        this.el.dataset.state = 'ready';
        this.drawStatus();
      } catch (err) {
        this.el.dataset.state = 'error';
        this.status.textContent = `No waveform: ${(err as Error).message}`;
      }
    })();
    return this.loading;
  }

  /** Redraws both views; the player calls this every animation frame while the sync panel is open. */
  draw(): void {
    const peaks = this.peaks;
    if (!peaks || !this.el.isConnected) return;
    const t = this.opts.currentTime();
    const pins = this.opts.pins();
    const { from, to } = viewWindow(t, this.span, peaks.duration);
    this.el.dataset.from = from.toFixed(3);
    this.el.dataset.to = to.toFixed(3);

    const colors = this.colors();
    // Detail: the waveform around the playhead, pins labelled with their bar.
    const d = this.prepare(this.detail, DETAIL_HEIGHT);
    if (d) {
      const { ctx, w, hgt, dpr } = d;
      this.drawWave(ctx, peaksInRange(peaks, from, to, w), w, hgt, colors.wave);
      const x = (time: number) => ((time - from) / (to - from)) * w;
      ctx.font = `${11 * dpr}px system-ui, sans-serif`;
      for (const p of pins) {
        if (p.time < from || p.time > to) continue;
        ctx.fillStyle = colors.pin;
        ctx.fillRect(Math.round(x(p.time)), 0, Math.max(1, dpr * 1.5), hgt);
        ctx.fillText(`${p.bar + 1}`, Math.round(x(p.time)) + 3 * dpr, 12 * dpr);
      }
      ctx.fillStyle = colors.playhead;
      ctx.fillRect(Math.round(x(t)), 0, Math.max(1, dpr * 1.5), hgt);
    }
    // Overview: the whole song, with the zoomed window shaded.
    const o = this.prepare(this.overview, OVERVIEW_HEIGHT);
    if (o && peaks.duration > 0) {
      const { ctx, w, hgt, dpr } = o;
      const x = (time: number) => (time / peaks.duration) * w;
      ctx.fillStyle = colors.window;
      ctx.fillRect(x(Math.max(0, from)), 0, Math.max(dpr, x(Math.min(to, peaks.duration)) - x(Math.max(0, from))), hgt);
      this.drawWave(ctx, peaksInRange(peaks, 0, peaks.duration, w), w, hgt, colors.wave);
      ctx.fillStyle = colors.pin;
      for (const p of pins) ctx.fillRect(Math.round(x(p.time)), 0, dpr, hgt);
      ctx.fillStyle = colors.playhead;
      ctx.fillRect(Math.round(x(t)), 0, Math.max(1, dpr * 1.5), hgt);
    }
  }

  private onDetailClick(e: MouseEvent): void {
    if (!this.peaks) return;
    const { from, to } = viewWindow(this.opts.currentTime(), this.span, this.peaks.duration);
    const t = Math.min(this.peaks.duration, Math.max(0, from + this.fraction(e, this.detail) * (to - from)));
    const snapped = e.altKey ? null : nearestOnset(this.peaks, t);
    this.opts.seek(snapped ?? t);
    this.el.dataset.lastClick = JSON.stringify({ clicked: +t.toFixed(3), snapped: snapped === null ? null : +snapped.toFixed(3) });
  }

  private zoom(dir: -1 | 1): void {
    const i = SPANS.indexOf(this.span);
    this.span = SPANS[Math.min(SPANS.length - 1, Math.max(0, i + dir))];
    this.drawStatus();
  }

  private drawStatus(): void {
    if (this.peaks) this.status.textContent = `${this.span} s view · click a note to move there`;
  }

  private fraction(e: MouseEvent, canvas: HTMLCanvasElement): number {
    const r = canvas.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }

  /** Sizes the canvas to its CSS box at device resolution and clears it. */
  private prepare(canvas: HTMLCanvasElement, cssHeight: number) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const hgt = Math.round(cssHeight * dpr);
    if (!w) return null;
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, w, hgt);
    return { ctx, w, hgt, dpr };
  }

  private drawWave(ctx: CanvasRenderingContext2D, cols: Float32Array, w: number, hgt: number, color: string): void {
    const mid = hgt / 2;
    ctx.fillStyle = color;
    for (let c = 0; c < w; c++) {
      const top = mid - cols[c * 2 + 1] * mid;
      const bottom = mid - cols[c * 2] * mid;
      ctx.fillRect(c, top, 1, Math.max(1, bottom - top));
    }
  }

  private colors() {
    const css = getComputedStyle(this.el);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return {
      wave: v('--muted', '#9aa1b1'),
      pin: v('--accent', '#f5b041'),
      playhead: v('--danger', '#e5534b'),
      window: 'rgb(255 255 255 / 0.08)',
    };
  }
}
