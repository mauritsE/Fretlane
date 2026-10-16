import type { NewSongInput, Song, SongPatch } from '../shared/types.ts';
import type { MediaSearchResponse, MediaSource, PublicSettings } from '../shared/mediaSearch.ts';
import type { CloudStatus, CloudTabSummary } from '../shared/cloud.ts';
import type { PremiumStatus } from '../shared/premium.ts';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* non-JSON error */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  listSongs: () => request<Song[]>('/api/songs'),
  getSong: (id: string) => request<Song>(`/api/songs/${encodeURIComponent(id)}`),
  addSong: (input: NewSongInput) => request<Song>('/api/songs', { method: 'POST', body: JSON.stringify(input) }),
  updateSong: (id: string, patch: SongPatch) =>
    request<Song>(`/api/songs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSong: (id: string) => request<{ ok: true }>(`/api/songs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  searchMedia: (source: MediaSource, q: string) =>
    request<MediaSearchResponse>(`/api/search?source=${source}&q=${encodeURIComponent(q)}`),
  getSettings: () => request<PublicSettings>('/api/settings'),
  setSpotifyCredentials: (spotifyClientId: string, spotifyClientSecret: string) =>
    request<PublicSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ spotifyClientId, spotifyClientSecret }) }),
  cloudStatus: () => request<CloudStatus>('/api/cloud/status'),
  cloudLogin: (origin: string) => request<{ url: string }>('/api/cloud/login', { method: 'POST', body: JSON.stringify({ origin }) }),
  cloudLogout: () => request<CloudStatus>('/api/cloud/logout', { method: 'POST' }),
  cloudTabs: () => request<CloudTabSummary[]>('/api/cloud/tabs'),
  importCloudTab: (id: string) => request<Song>(`/api/cloud/tabs/${encodeURIComponent(id)}/import`, { method: 'POST' }),
  /** Fretlane Premium (the tab editor). `refresh` asks the website again instead of the cached answer. */
  premium: (refresh = false) => request<PremiumStatus>('/api/premium', refresh ? { method: 'POST' } : undefined),
  /** Saves a written song's tab (alphaTex). `keepalive` lets the save finish while the page closes. */
  async saveTab(id: string, tex: string, keepalive = false): Promise<Song> {
    const res = await fetch(`/api/songs/${encodeURIComponent(id)}/tab`, {
      method: 'PUT',
      body: tex,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      keepalive,
    });
    const body = (await res.json().catch(() => ({}))) as Song & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `Could not save the tab (${res.status})`);
    return body;
  },
  /** Uploads the user's own recording (raw bytes, not JSON: WAV files are big). */
  async uploadAudio(id: string, file: File): Promise<Song> {
    const res = await fetch(`/api/songs/${encodeURIComponent(id)}/audio`, {
      method: 'PUT',
      body: file,
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
    });
    const body = (await res.json().catch(() => ({}))) as Song & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `Could not upload the audio file (${res.status})`);
    return body;
  },
  audioUrl: (song: Song) => `/api/songs/${encodeURIComponent(song.id)}/audio?v=${encodeURIComponent(song.updatedAt)}`,
  async getTab(id: string): Promise<Uint8Array> {
    const res = await fetch(`/api/songs/${encodeURIComponent(id)}/tab`);
    if (!res.ok) throw new Error(`Could not load tab (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  },
};

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
