/**
 * Server half of Fretlane Cloud (see shared/cloud.ts for the sign-in flow). It runs here, not in the
 * browser, so the session lives in the library folder (cloud.json, readable only by the user) and
 * stays signed in across restarts, and because the desktop window and the browser that signs in are
 * different programs: the callback lands on this server either way.
 *
 * Talks to Supabase's REST endpoints directly (auth, PostgREST, storage) to avoid a dependency.
 * Overrides for testing or self-hosting: FRETLANE_CLOUD_SITE, FRETLANE_CLOUD_API, FRETLANE_CLOUD_KEY.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { envVar } from '../shared/brand.ts';
import {
  CLOUD_TAB_COLUMNS,
  DEFAULT_CLOUD,
  connectUrl,
  isLoopbackHttpUrl,
  type CloudConfig,
  type CloudStatus,
  type CloudTabRow,
} from '../shared/cloud.ts';
import { HttpError } from './library.ts';

const TIMEOUT_MS = 15_000;
/** How long a sign-in started in the app may take to come back. */
const LOGIN_TTL_MS = 15 * 60_000;
const MAX_TAB_BYTES = 20 * 1024 * 1024;

interface StoredSession {
  refreshToken: string;
  email: string;
}

interface Session extends StoredSession {
  accessToken: string;
  /** ms epoch; refreshed a minute early. */
  expires: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { email?: string };
  error_description?: string;
  msg?: string;
}

export function cloudConfigFromEnv(): CloudConfig {
  return {
    siteUrl: envVar('CLOUD_SITE') ?? DEFAULT_CLOUD.siteUrl,
    apiUrl: (envVar('CLOUD_API') ?? DEFAULT_CLOUD.apiUrl).replace(/\/+$/, ''),
    apiKey: envVar('CLOUD_KEY') ?? DEFAULT_CLOUD.apiKey,
  };
}

export class FretlaneCloud {
  private readonly file: string;
  private session: Session | null = null;
  private stored: StoredSession | null = null;
  private readonly pending = new Map<string, number>();
  private refreshing: Promise<Session> | null = null;

  constructor(
    libraryDir: string,
    private readonly config: CloudConfig = cloudConfigFromEnv(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.file = path.join(libraryDir, 'cloud.json');
  }

  async init(): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<StoredSession>;
      if (data.refreshToken) this.stored = { refreshToken: data.refreshToken, email: data.email ?? '' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  status(): CloudStatus {
    return { connected: !!this.stored, email: this.stored?.email ?? '', siteUrl: this.config.siteUrl };
  }

  /** Starts a sign-in. `callbackUrl` is this server's /api/cloud/callback as the UI reaches it. */
  startLogin(callbackUrl: string): { url: string } {
    if (!isLoopbackHttpUrl(callbackUrl)) throw new HttpError(400, 'The sign-in callback must be on this computer.');
    const now = Date.now();
    for (const [s, exp] of this.pending) if (exp < now) this.pending.delete(s);
    const state = randomBytes(24).toString('base64url');
    this.pending.set(state, now + LOGIN_TTL_MS);
    return { url: connectUrl(this.config.siteUrl, callbackUrl, state) };
  }

  /** The website sent the browser back with a one-time token: trade it for this app's own session. */
  async finishLogin(state: string, tokenHash: string): Promise<CloudStatus> {
    const exp = this.pending.get(state);
    if (!exp || exp < Date.now()) throw new HttpError(400, 'This sign-in link has expired or was not started from this Fretlane. Start again from Fretlane.');
    if (!tokenHash) throw new HttpError(400, 'The website did not send a sign-in token.');
    this.pending.delete(state);
    const body = await this.authRequest('verify', { type: 'magiclink', token_hash: tokenHash });
    await this.saveSession(body);
    return this.status();
  }

  async logout(): Promise<CloudStatus> {
    const session = this.session;
    this.session = null;
    this.stored = null;
    await fs.rm(this.file, { force: true });
    if (session) {
      // Best effort: revoke this app's session on the server too. Signing out locally already happened.
      await this.request(`${this.config.apiUrl}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: this.headers(session.accessToken),
      }).catch(() => undefined);
    }
    return this.status();
  }

  async listTabs(): Promise<CloudTabRow[]> {
    const res = await this.authed(`/rest/v1/tabs?select=${CLOUD_TAB_COLUMNS}&order=created_at.desc`);
    return (await res.json()) as CloudTabRow[];
  }

  async getTab(id: string): Promise<CloudTabRow> {
    const res = await this.authed(`/rest/v1/tabs?select=${CLOUD_TAB_COLUMNS}&id=eq.${encodeURIComponent(id)}`);
    const rows = (await res.json()) as CloudTabRow[];
    if (!rows[0]) throw new HttpError(404, 'That tab is not in your Fretlane Cloud library (any more).');
    return rows[0];
  }

  async downloadTab(row: CloudTabRow): Promise<Uint8Array> {
    const objectPath = row.file_path.split('/').map(encodeURIComponent).join('/');
    const res = await this.authed(`/storage/v1/object/authenticated/tabs/${objectPath}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_TAB_BYTES) throw new HttpError(413, 'Tab file is larger than 20 MB.');
    return bytes;
  }

  /** A signed-in GET against the cloud API. Refreshes the session once if the server rejects it. */
  private async authed(apiPath: string): Promise<Response> {
    let session = await this.currentSession();
    let res = await this.request(this.config.apiUrl + apiPath, { headers: this.headers(session.accessToken) });
    if (res.status === 401 || res.status === 403) {
      session = await this.refresh(session.refreshToken);
      res = await this.request(this.config.apiUrl + apiPath, { headers: this.headers(session.accessToken) });
    }
    if (res.status === 401) throw new HttpError(401, 'Your Fretlane Cloud sign-in has expired. Sign in again.');
    if (!res.ok) throw new HttpError(502, `Fretlane Cloud answered ${res.status}.`);
    return res;
  }

  private async currentSession(): Promise<Session> {
    if (this.session && this.session.expires > Date.now()) return this.session;
    const refreshToken = this.session?.refreshToken ?? this.stored?.refreshToken;
    if (!refreshToken) throw new HttpError(401, 'Not signed in to Fretlane Cloud.');
    return this.refresh(refreshToken);
  }

  /** One refresh at a time: Supabase rotates refresh tokens, and reusing an old one signs you out. */
  private refresh(refreshToken: string): Promise<Session> {
    this.refreshing ??= (async () => {
      try {
        // Another request may have refreshed while this one waited.
        if (this.session && this.session.refreshToken !== refreshToken && this.session.expires > Date.now()) return this.session;
        const body = await this.authRequest('token?grant_type=refresh_token', { refresh_token: refreshToken });
        return await this.saveSession(body);
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async authRequest(endpoint: string, payload: Record<string, string>): Promise<TokenResponse> {
    const res = await this.request(`${this.config.apiUrl}/auth/v1/${endpoint}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as TokenResponse;
    if (res.ok && body.access_token && body.refresh_token) return body;
    if (res.status >= 400 && res.status < 500) {
      // A refresh token that no longer works will never work again: forget it.
      if (endpoint.startsWith('token')) await this.forget();
      throw new HttpError(401, `Fretlane Cloud sign-in failed: ${body.error_description ?? body.msg ?? res.status}. Sign in again.`);
    }
    throw new HttpError(502, `Fretlane Cloud sign-in failed (${res.status}).`);
  }

  private async saveSession(body: TokenResponse): Promise<Session> {
    const session: Session = {
      accessToken: body.access_token!,
      refreshToken: body.refresh_token!,
      email: body.user?.email ?? this.stored?.email ?? '',
      expires: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
    };
    this.session = session;
    this.stored = { refreshToken: session.refreshToken, email: session.email };
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.stored, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
    return session;
  }

  private async forget(): Promise<void> {
    this.session = null;
    this.stored = null;
    await fs.rm(this.file, { force: true });
  }

  private headers(accessToken?: string): Record<string, string> {
    return { apikey: this.config.apiKey, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new HttpError(502, 'Could not reach Fretlane Cloud. Are you online?');
    }
  }
}
