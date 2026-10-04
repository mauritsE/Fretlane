/**
 * Thin typed wrapper around the YouTube IFrame Player API.
 * https://developers.google.com/youtube/iframe_api_reference
 */
import type { MediaEvents, MediaPlayer, MediaState } from './media.ts';

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
        onPlaybackRateChange?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('Could not load the YouTube player (are you offline?)'));
    };
    document.head.append(script);
  });
  return apiPromise;
}

const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

const ERRORS: Record<number, string> = {
  2: 'Invalid YouTube video id.',
  5: 'This video cannot be played in an HTML5 player.',
  100: 'Video not found (removed or private).',
  101: 'The owner does not allow this video to be embedded.',
  150: 'The owner does not allow this video to be embedded.',
};

const STATES: Partial<Record<number, MediaState>> = {
  [YT_STATE.PLAYING]: 'playing',
  [YT_STATE.PAUSED]: 'paused',
  [YT_STATE.ENDED]: 'ended',
};

export class YouTubeVideo implements MediaPlayer {
  private player: YTPlayer | null = null;
  private ready!: Promise<void>;

  static async create(host: HTMLElement, videoId: string, events: MediaEvents): Promise<YouTubeVideo> {
    const yt = await loadApi();
    const v = new YouTubeVideo();
    const mount = document.createElement('div');
    host.replaceChildren(mount);
    v.ready = new Promise<void>((resolve) => {
      v.player = new yt.Player(mount, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1 },
        events: {
          onReady: () => resolve(),
          onStateChange: (e) => events.onStateChange?.(STATES[e.data] ?? 'other'),
          onError: (e) => events.onError?.(ERRORS[e.data] ?? `YouTube error ${e.data}`),
        },
      });
    });
    await v.ready;
    return v;
  }

  get currentTime(): number {
    return this.player?.getCurrentTime() ?? 0;
  }
  get duration(): number {
    return this.player?.getDuration() ?? 0;
  }
  get state(): number {
    return this.player?.getPlayerState() ?? YT_STATE.UNSTARTED;
  }
  play(): void {
    this.player?.playVideo();
  }
  pause(): void {
    this.player?.pauseVideo();
  }
  seek(seconds: number): void {
    this.player?.seekTo(Math.max(0, seconds), true);
  }
  setRate(rate: number): void {
    this.player?.setPlaybackRate(rate);
  }
  setVolume(v: number): void {
    this.player?.setVolume(Math.round(v * 100));
  }
  destroy(): void {
    this.player?.destroy();
    this.player = null;
  }
}
