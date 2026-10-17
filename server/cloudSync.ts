/**
 * Backs songs written in Fretlane up to Fretlane Cloud while the user is signed in. A change to a
 * written song (the editor's autosave, a new title, a new recording) schedules an upload a few
 * seconds later, so a burst of edits is one upload. Songs changed while signed out or offline are
 * caught up after signing in and when the app starts. One upload runs at a time.
 *
 * The cloud copy follows the app: it is created on the first upload (the song's `cloudId`) and
 * replaced on later ones. Deleting a song in the app leaves its cloud copy alone, as a backup.
 */
import { promises as fs } from 'node:fs';
import { cloudTabFields, needsCloudSync, type CloudSyncStatus } from '../shared/cloud.ts';
import type { FretlaneCloud } from './cloud.ts';
import { HttpError, type Library } from './library.ts';

/** Quiet time after the last change before uploading. */
const DEFAULT_DELAY_MS = 5_000;
/** Offline: try again after this long, doubling up to RETRY_MAX_MS. */
const RETRY_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;

export class CloudSync {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly queue: string[] = [];
  private readonly errors = new Map<string, string>();
  private readonly retryIn = new Map<string, number>();
  private running: string | null = null;
  private worker: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly library: Library,
    private readonly cloud: FretlaneCloud,
    private readonly delayMs = DEFAULT_DELAY_MS,
  ) {}

  /** Call after a written song changed. Does nothing for other songs or while signed out. */
  schedule(songId: string, delay = this.delayMs): void {
    const song = this.library.get(songId);
    if (this.closed || !song?.written || !this.cloud.status().connected) return;
    this.errors.delete(songId);
    clearTimeout(this.timers.get(songId));
    this.timers.set(
      songId,
      setTimeout(() => {
        this.timers.delete(songId);
        this.enqueue(songId);
      }, delay),
    );
  }

  /** Uploads every written song with changes the cloud doesn't have (after sign-in, at start). */
  syncAll(): void {
    if (!this.cloud.status().connected) return;
    for (const song of this.library.list()) if (needsCloudSync(song)) this.schedule(song.id, 0);
  }

  /** Forget a song (deleted) or everything (signed out). */
  cancel(songId?: string): void {
    for (const id of songId ? [songId] : [...this.timers.keys()]) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
    }
    if (songId) {
      this.errors.delete(songId);
      this.retryIn.delete(songId);
    } else {
      this.errors.clear();
      this.retryIn.clear();
    }
    this.queue.splice(0, this.queue.length, ...(songId ? this.queue.filter((id) => id !== songId) : []));
  }

  status(songId: string): CloudSyncStatus {
    const song = this.library.get(songId);
    if (!song?.written || !this.cloud.status().connected) return { state: 'off' };
    if (this.running === songId) return { state: 'syncing' };
    const error = this.errors.get(songId);
    if (error) return { state: 'error', message: error };
    if (this.timers.has(songId) || this.queue.includes(songId) || needsCloudSync(song)) return { state: 'pending' };
    return { state: 'synced' };
  }

  /** Resolves when nothing is scheduled or uploading (for tests). */
  async idle(): Promise<void> {
    while (this.timers.size || this.worker) {
      await (this.worker ?? new Promise((r) => setTimeout(r, 10)));
    }
  }

  close(): void {
    this.closed = true;
    this.cancel();
  }

  private enqueue(songId: string): void {
    if (!this.queue.includes(songId)) this.queue.push(songId);
    this.worker ??= this.work().finally(() => {
      this.worker = null;
    });
  }

  private async work(): Promise<void> {
    for (let id = this.queue.shift(); id; id = this.queue.shift()) {
      this.running = id;
      try {
        await this.upload(id);
      } finally {
        this.running = null;
      }
    }
  }

  private async upload(songId: string): Promise<void> {
    const song = this.library.get(songId);
    if (!song?.written || !needsCloudSync(song) || !this.cloud.status().connected) return;
    const version = song.updatedAt;
    try {
      const bytes = await fs.readFile(this.library.tabPath(song));
      const cloudId = await this.cloud.saveTab(song.cloudId ?? null, cloudTabFields(song), bytes);
      await this.library.markCloudSynced(songId, cloudId, version);
      this.errors.delete(songId);
      this.retryIn.delete(songId);
      // Edited again while uploading: that version goes up next.
      const now = this.library.get(songId);
      if (now && needsCloudSync(now)) this.schedule(songId);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      this.errors.set(songId, (err as Error).message);
      if (status === 500) console.error('Fretlane Cloud backup failed:', err);
      // Offline or the website had a hiccup: try again later. A missing plan or a sign-in that
      // stopped working waits for the next change or sign-in instead.
      if (status === 502 || status === 500) {
        const wait = this.retryIn.get(songId) ?? RETRY_MS;
        this.retryIn.set(songId, Math.min(RETRY_MAX_MS, wait * 2));
        const message = this.errors.get(songId)!;
        this.schedule(songId, wait);
        this.errors.set(songId, message);
      }
    }
  }
}
