import type { NewSongInput, Song, SongPatch } from '../shared/types.ts';
import type { MediaSearchResponse, MediaSource, PublicSettings } from '../shared/mediaSearch.ts';

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
