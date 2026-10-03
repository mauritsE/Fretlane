/**
 * A playback clock for players that only report their position now and then (Spotify's embed sends
 * `playback_update` events a few times per second). Between reports the position is extrapolated
 * from the wall clock, so the tab cursor moves smoothly instead of jumping at every report.
 *
 * All times are seconds; `now` is a wall-clock reading in milliseconds (performance.now()).
 */
export class MediaClock {
  private position = 0;
  private at = 0;
  private playing = false;

  constructor(private duration = 0) {}

  /** A position report from the player. */
  report(positionSec: number, playing: boolean, now: number, durationSec?: number): void {
    if (durationSec !== undefined && durationSec > 0) this.duration = durationSec;
    this.position = Math.max(0, positionSec);
    this.at = now;
    this.playing = playing;
  }

  /** Jump to a position right away (after a seek), before the player confirms it. */
  set(positionSec: number, now: number): void {
    this.report(positionSec, this.playing, now);
  }

  /** The extrapolated position at `now`, never past the end. */
  read(now: number): number {
    const t = this.playing ? this.position + Math.max(0, now - this.at) / 1000 : this.position;
    return this.duration > 0 ? Math.min(t, this.duration) : t;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get length(): number {
    return this.duration;
  }
}
