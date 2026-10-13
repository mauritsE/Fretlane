/**
 * Fretlane Cloud: the paid tab storage at the Fretlane website (repo mauritsE/fretlane-sync-magic).
 * The website stores tabs in a Supabase `tabs` table plus a private `tabs` storage bucket. Row-level
 * security limits both to the signed-in owner, so the app only ever sees the user's own tabs.
 *
 * Signing in ("device link"): the app opens `<site>/connect?return=<loopback callback>&state=…` in
 * the browser. The user signs in there with Google, and the site sends the browser back to the app's
 * callback with a one-time `token_hash`. The app trades that for its own session, so it never shares
 * (and never rotates away) the website's session.
 */
import type { NewSongInput, SyncPoint } from './types.ts';
import { parseMediaLink } from './util.ts';

export interface CloudConfig {
  /** The website, where the user signs in. */
  siteUrl: string;
  /** The Supabase API the website uses. */
  apiUrl: string;
  /** Supabase publishable key. Public by design: row-level security does the protecting. */
  apiKey: string;
}

export const DEFAULT_CLOUD: CloudConfig = {
  siteUrl: 'https://fretlane-sync-magic.lovable.app',
  apiUrl: 'https://c--47485661-84b7-4539-8243-dddc255fb9bf-prod.lovable.cloud',
  apiKey: 'sb_publishable_kC7AwvAIwomnQtCwN3Dlvg_cZsDGFsn',
};

/** Columns of the website's `public.tabs` table that the app reads. */
export interface CloudTabRow {
  id: string;
  title: string;
  artist: string | null;
  /** Storage path in the `tabs` bucket: `{user_id}/{uuid}.{ext}`. */
  file_path: string;
  /** File extension without the dot, e.g. "gp5" or "txt". */
  format: string | null;
  spotify_url: string | null;
  youtube_url: string | null;
  /** Seconds the recording runs before bar 1 starts. */
  sync_offset: number | null;
  updated_at: string;
}

export const CLOUD_TAB_COLUMNS = 'id,title,artist,file_path,format,spotify_url,youtube_url,sync_offset,updated_at';

/** What the library dialog shows for one cloud tab. */
export interface CloudTabSummary {
  id: string;
  title: string;
  artist: string;
  format: string;
  media: 'youtube' | 'spotify' | '';
  /** The local song imported from this tab, if any. */
  songId: string | null;
}

export interface CloudStatus {
  connected: boolean;
  email: string;
  siteUrl: string;
}

/** Only loopback http URLs may receive a sign-in token: it must never leave this computer. */
export function isLoopbackHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function connectUrl(siteUrl: string, callbackUrl: string, state: string): string {
  const url = new URL('/connect', siteUrl);
  url.searchParams.set('return', callbackUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

/** The file extension of a cloud tab, from `format` or else the storage path. */
export function cloudTabExtension(row: Pick<CloudTabRow, 'format' | 'file_path'>): string {
  const fromFormat = (row.format ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromFormat) return fromFormat;
  const m = row.file_path.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : 'txt';
}

/**
 * The recording a cloud tab plays with. The website lets a tab link both YouTube and Spotify; a
 * Fretlane song has one, because sync pins belong to one recording. YouTube wins: it can slow down.
 */
export function cloudTabMedia(row: Pick<CloudTabRow, 'youtube_url' | 'spotify_url'>): string {
  for (const link of [row.youtube_url, row.spotify_url]) {
    const parsed = parseMediaLink(link);
    if (parsed.youtubeId || parsed.spotifyId) return link!;
  }
  return '';
}

/**
 * The website keeps one offset per tab ("the song starts N seconds before the tab"). In Fretlane
 * that is a single sync pin on bar 1. Zero or negative offsets have no pin equivalent.
 */
export function cloudSyncPoints(row: Pick<CloudTabRow, 'sync_offset'>, media: string): SyncPoint[] {
  const offset = Number(row.sync_offset);
  return media && Number.isFinite(offset) && offset > 0 ? [{ bar: 0, time: Math.round(offset * 1000) / 1000 }] : [];
}

export function summarizeCloudTab(row: CloudTabRow, songId: string | null): CloudTabSummary {
  const media = parseMediaLink(cloudTabMedia(row));
  return {
    id: row.id,
    title: row.title,
    artist: row.artist ?? '',
    format: cloudTabExtension(row),
    media: media.youtubeId ? 'youtube' : media.spotifyId ? 'spotify' : '',
    songId,
  };
}

/** The library import for a downloaded cloud tab. */
export function cloudTabToSongInput(row: CloudTabRow, bytes: Uint8Array): NewSongInput {
  const media = cloudTabMedia(row);
  const base = row.title.replace(/[\\/:*?"<>|\0]+/g, ' ').replace(/\s+/g, ' ').trim() || 'tab';
  return {
    title: row.title,
    artist: row.artist ?? '',
    media,
    tags: ['cloud'],
    tabFile: { name: `${base}.${cloudTabExtension(row)}`, dataBase64: toBase64(bytes) },
    cloudId: row.id,
    syncPoints: cloudSyncPoints(row, media),
  };
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
