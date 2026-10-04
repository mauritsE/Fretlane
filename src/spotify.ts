/**
 * Thin typed wrapper around Spotify's iFrame (embed) API.
 * https://developer.spotify.com/documentation/embeds/references/iframe-api
 *
 * What the embed can do: play, pause, seek and report its position. It can't change speed or
 * volume. Without a Spotify login in this browser it only plays a 30-second preview.
 */
import { MediaClock } from '../shared/mediaClock.ts';
import type { MediaEvents, MediaPlayer, MediaState } from './media.ts';

interface PlaybackUpdate {
  data: { isPaused: boolean; isBuffering: boolean; duration: number; position: number };
}

interface EmbedController {
  addListener(event: 'ready', cb: () => void): void;
  addListener(event: 'playback_update', cb: (e: PlaybackUpdate) => void): void;
  play(): void;
  resume(): void;
  pause(): void;
  seek(seconds: number): void;
  destroy(): void;
}

interface SpotifyIFrameAPI {
  createController(
    el: HTMLElement,
    opts: { uri: string; width?: string | number; height?: string | number },
    cb: (controller: EmbedController) => void,
  ): void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIFrameAPI) => void;
  }
}

const SCRIPT = 'https://open.spotify.com/embed/iframe-api/v1';
/** Previews are 30 seconds; a track that short is almost always a preview. */
const PREVIEW_MAX_SEC = 31;

let apiPromise: Promise<SpotifyIFrameAPI> | null = null;

function loadApi(): Promise<SpotifyIFrameAPI> {
  apiPromise ??= new Promise<SpotifyIFrameAPI>((resolve, reject) => {
    // The script calls this once, when it has loaded.
    window.onSpotifyIframeApiReady = resolve;
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      script.remove();
      reject(new Error('Could not load the Spotify player (are you offline?)'));
    };
    document.head.append(script);
  });
  return apiPromise;
}

export class SpotifyTrack implements MediaPlayer {
  private controller: EmbedController | null = null;
  private readonly clock = new MediaClock();
  private state: MediaState = 'other';
  /** Spotify's play() starts from the top; resume() continues. Use play() only the first time. */
  private started = false;
  /** A seek requested before the first play: the embed ignores it, so it is applied once playing. */
  private seekOnStart: number | null = null;
  private warnedPreview = false;

  private constructor(private readonly events: MediaEvents & { onPreview?: () => void }) {}

  static async create(host: HTMLElement, trackId: string, events: MediaEvents & { onPreview?: () => void }): Promise<SpotifyTrack> {
    const api = await loadApi();
    const t = new SpotifyTrack(events);
    const mount = document.createElement('div');
    host.replaceChildren(mount);
    await new Promise<void>((resolve) => {
      api.createController(mount, { uri: `spotify:track:${trackId}`, width: '100%', height: 152 }, (c) => {
        t.controller = c;
        c.addListener('playback_update', (e) => t.onUpdate(e.data));
        c.addListener('ready', () => resolve());
        // Don't hang the page if 'ready' never comes; the controller works without it.
        window.setTimeout(resolve, 10000);
      });
    });
    return t;
  }

  private onUpdate(d: PlaybackUpdate['data']): void {
    const now = performance.now();
    const playing = !d.isPaused;
    const duration = d.duration / 1000;
    let position = d.position / 1000;
    if (playing) this.started = true;
    if (playing && this.seekOnStart !== null) {
      const target = this.seekOnStart;
      this.seekOnStart = null;
      this.seek(target);
      position = target;
    }
    this.clock.report(position, playing && !d.isBuffering, now, duration);

    if (duration > 0 && duration <= PREVIEW_MAX_SEC && !this.warnedPreview) {
      this.warnedPreview = true;
      this.events.onPreview?.();
    }
    const ended = d.isPaused && duration > 0 && position >= duration - 0.5;
    this.setState(playing ? 'playing' : ended ? 'ended' : 'paused');
  }

  private setState(s: MediaState): void {
    if (s === this.state) return;
    this.state = s;
    this.events.onStateChange?.(s);
  }

  get currentTime(): number {
    return this.clock.read(performance.now());
  }
  get duration(): number {
    return this.clock.length;
  }
  play(): void {
    if (!this.controller) return;
    if (this.started) {
      this.controller.resume();
      return;
    }
    this.started = true;
    this.controller.play();
  }
  pause(): void {
    this.controller?.pause();
  }
  seek(seconds: number): void {
    const target = Math.max(0, seconds);
    const now = performance.now();
    this.clock.set(target, now);
    if (!this.started) {
      // Remembered for the first play(), which always starts from the top.
      this.seekOnStart = target > 0.05 ? target : null;
      return;
    }
    this.controller?.seek(target);
  }
  setRate(): void {
    /* not supported by the embed */
  }
  setVolume(): void {
    /* not supported by the embed */
  }
  destroy(): void {
    this.controller?.destroy();
    this.controller = null;
  }
}
