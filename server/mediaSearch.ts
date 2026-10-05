/**
 * Server half of "find a recording". It runs here, not in the browser, because neither YouTube nor
 * Spotify allows these requests from another origin.
 *
 * - YouTube: the same JSON endpoint youtube.com's own search box calls. No API key, but it is not
 *   a public API: when YouTube changes it, search fails and the dialog falls back to a link to the
 *   YouTube results page.
 * - Spotify: the documented Web API, which needs a (free) developer app. The user's Client ID and
 *   secret are stored in the library's settings.json, or come from FRETLANE_SPOTIFY_CLIENT_ID /
 *   FRETLANE_SPOTIFY_CLIENT_SECRET.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { envVar } from '../shared/brand.ts';
import {
  parseSpotifySearch,
  parseYouTubeSearch,
  rankResults,
  searchPageUrl,
  type MediaSearchResponse,
  type MediaSource,
  type PublicSettings,
} from '../shared/mediaSearch.ts';
import { HttpError } from './library.ts';

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 12;

export interface SpotifyCredentials {
  clientId: string;
  clientSecret: string;
}

interface StoredSettings {
  spotifyClientId?: string;
  spotifyClientSecret?: string;
}

export class MediaSearch {
  private readonly file: string;
  private stored: StoredSettings = {};
  private token: { value: string; expires: number; for: string } | null = null;

  constructor(
    libraryDir: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.file = path.join(libraryDir, 'settings.json');
  }

  async init(): Promise<void> {
    try {
      this.stored = JSON.parse(await fs.readFile(this.file, 'utf8')) as StoredSettings;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  private envCredentials(): SpotifyCredentials | null {
    const clientId = envVar('SPOTIFY_CLIENT_ID');
    const clientSecret = envVar('SPOTIFY_CLIENT_SECRET');
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  private credentials(): SpotifyCredentials | null {
    const env = this.envCredentials();
    if (env) return env;
    const { spotifyClientId: clientId, spotifyClientSecret: clientSecret } = this.stored;
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  publicSettings(): PublicSettings {
    return { spotifySearch: !!this.credentials(), spotifyFromEnv: !!this.envCredentials() };
  }

  /** Saves Spotify credentials after checking them with Spotify. Empty values remove them. */
  async setSpotifyCredentials(clientId: string, clientSecret: string): Promise<PublicSettings> {
    clientId = clientId.trim();
    clientSecret = clientSecret.trim();
    if (clientId || clientSecret) {
      if (!clientId || !clientSecret) throw new HttpError(400, 'Enter both the Client ID and the Client secret.');
      await this.spotifyToken({ clientId, clientSecret }); // throws a readable error when they're wrong
      this.stored = { ...this.stored, spotifyClientId: clientId, spotifyClientSecret: clientSecret };
    } else {
      const { spotifyClientId: _id, spotifyClientSecret: _secret, ...rest } = this.stored;
      this.stored = rest;
    }
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.stored, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
    return this.publicSettings();
  }

  async search(source: MediaSource, query: string): Promise<MediaSearchResponse> {
    query = query.trim().slice(0, 200);
    const openUrl = searchPageUrl(source, query);
    if (!query) return { results: [], openUrl, error: 'Type what to search for.' };
    try {
      const raw = source === 'youtube' ? await this.searchYouTube(query) : await this.searchSpotify(query);
      return { results: rankResults(raw, query).slice(0, MAX_RESULTS), openUrl };
    } catch (err) {
      return { results: [], openUrl, error: (err as Error).message };
    }
  }

  private async request(url: string, init: RequestInit, what: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new Error(`Could not reach ${what}. Are you online?`);
    }
  }

  private async searchYouTube(query: string) {
    const res = await this.request(
      'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } },
          query,
          params: 'EgIQAQ==', // filter: videos only
        }),
      },
      'YouTube',
    );
    if (!res.ok) throw new Error(`YouTube search failed (${res.status}).`);
    const results = parseYouTubeSearch(await res.json());
    if (!results.length) throw new Error('YouTube returned no videos. Try other words, or search on YouTube itself.');
    return results;
  }

  private async spotifyToken(creds: SpotifyCredentials): Promise<string> {
    if (this.token && this.token.for === creds.clientId && this.token.expires > Date.now()) return this.token.value;
    const res = await this.request(
      'https://accounts.spotify.com/api/token',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
        },
        body: 'grant_type=client_credentials',
      },
      'Spotify',
    );
    if (res.status === 400 || res.status === 401) throw new HttpError(400, 'Spotify did not accept this Client ID and secret.');
    if (!res.ok) throw new Error(`Spotify login failed (${res.status}).`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Spotify login failed: no access token.');
    // Renew a minute early so a search never runs on a token that expires mid-request.
    this.token = { value: body.access_token, expires: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000, for: creds.clientId };
    return body.access_token;
  }

  private async searchSpotify(query: string) {
    const creds = this.credentials();
    if (!creds) throw new Error('Spotify search needs a Spotify developer Client ID and secret.');
    const run = async () =>
      this.request(
        `https://api.spotify.com/v1/search?type=track&limit=20&q=${encodeURIComponent(query)}`,
        { headers: { authorization: `Bearer ${await this.spotifyToken(creds)}` } },
        'Spotify',
      );
    let res = await run();
    if (res.status === 401) {
      this.token = null; // revoked or expired early: log in again once
      res = await run();
    }
    if (res.status === 429) throw new Error('Spotify says too many searches. Wait a minute and try again.');
    if (!res.ok) throw new Error(`Spotify search failed (${res.status}).`);
    const results = parseSpotifySearch(await res.json());
    if (!results.length) throw new Error('Spotify found no tracks. Try other words.');
    return results;
  }
}
