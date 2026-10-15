/**
 * The user's own recording (an MP3, WAV, …) played by an `<audio>` element. Unlike the YouTube and
 * Spotify embeds it can do everything: any speed (pitch is preserved), volume, and exact seeking.
 */
import type { MediaEvents, MediaPlayer } from './media.ts';

const ERRORS: Record<number, string> = {
  2: 'The audio file could not be downloaded from the library.',
  3: 'The audio file is damaged or uses an encoding this browser cannot decode.',
  4: 'This browser cannot play this audio format.',
};

export class AudioFilePlayer implements MediaPlayer {
  private constructor(
    private readonly audio: HTMLAudioElement,
    private readonly events: MediaEvents,
  ) {}

  static async create(host: HTMLElement, src: string, name: string, events: MediaEvents): Promise<AudioFilePlayer> {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'auto';
    audio.preservesPitch = true;
    audio.src = src;
    host.replaceChildren(
      Object.assign(document.createElement('div'), { className: 'audio-name', textContent: `🎵 ${name}`, title: name }),
      audio,
    );
    const p = new AudioFilePlayer(audio, events);
    audio.addEventListener('playing', () => events.onStateChange?.('playing'));
    audio.addEventListener('pause', () => !audio.ended && events.onStateChange?.('paused'));
    audio.addEventListener('ended', () => events.onStateChange?.('ended'));
    audio.addEventListener('error', () => events.onError?.(ERRORS[audio.error?.code ?? 0] ?? 'The audio file could not be played.'));
    // Wait for the duration, which alphaTab reads when the tab loads. A broken file reports through onError.
    await new Promise<void>((resolve) => {
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return resolve();
      audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
      audio.addEventListener('error', () => resolve(), { once: true });
    });
    return p;
  }

  get currentTime(): number {
    return this.audio.currentTime;
  }
  get duration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  }
  play(): void {
    this.audio.play().catch((err: DOMException) => {
      // AbortError: a pause() came first, which is fine. NotAllowedError: no click started it.
      if (err.name === 'NotAllowedError') this.events.onError?.('The browser blocked playback. Press play on the audio player.');
    });
  }
  pause(): void {
    this.audio.pause();
  }
  seek(seconds: number): void {
    this.audio.currentTime = Math.max(0, seconds);
  }
  setRate(rate: number): void {
    this.audio.playbackRate = rate;
  }
  setVolume(volume: number): void {
    this.audio.volume = Math.min(1, Math.max(0, volume));
  }
  destroy(): void {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load(); // stops the download
  }
}
