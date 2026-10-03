/** What the player page needs from a recording the tab plays along with (YouTube or Spotify). */
export type MediaState = 'playing' | 'paused' | 'ended' | 'other';

export interface MediaEvents {
  onStateChange?: (state: MediaState) => void;
  onError?: (message: string) => void;
}

export type MediaKind = 'youtube' | 'spotify';

export const MEDIA_KINDS: Record<MediaKind, { label: string; noun: string; rates: number[] }> = {
  youtube: { label: 'YouTube', noun: 'video', rates: [0.25, 0.5, 0.75, 1, 1.25, 1.5] },
  // The Spotify embed has no speed control.
  spotify: { label: 'Spotify', noun: 'track', rates: [1] },
};

export interface MediaPlayer {
  /** Seconds. */
  readonly currentTime: number;
  /** Seconds, 0 while unknown. */
  readonly duration: number;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  /** 0..1 */
  setVolume(volume: number): void;
  destroy(): void;
}
