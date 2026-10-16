import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cloudSyncPoints,
  cloudTabExtension,
  cloudTabMedia,
  cloudTabToSongInput,
  connectUrl,
  isLoopbackHttpUrl,
  summarizeCloudTab,
  type CloudConfig,
  type CloudTabRow,
} from '../shared/cloud.ts';
import { FretlaneCloud } from '../server/cloud.ts';
import { HttpError, Library } from '../server/library.ts';

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SP = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';
const ASCII = ['e|--0--3--|', 'B|--1--0--|', 'G|--0--0--|', 'D|--2--0--|', 'A|--3--2--|', 'E|-----3--|'].join('\n');

function row(over: Partial<CloudTabRow> = {}): CloudTabRow {
  return {
    id: 'tab-1',
    title: 'Night Ride',
    artist: 'The Testers',
    file_path: 'user-1/abc.txt',
    format: 'txt',
    spotify_url: null,
    youtube_url: YT,
    sync_offset: 2.5,
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

describe('shared cloud helpers', () => {
  it('only lets sign-in tokens go to this computer', () => {
    expect(isLoopbackHttpUrl('http://127.0.0.1:5173/api/cloud/callback')).toBe(true);
    expect(isLoopbackHttpUrl('http://localhost:5173/api/cloud/callback')).toBe(true);
    expect(isLoopbackHttpUrl('http://[::1]:5173/x')).toBe(true);
    expect(isLoopbackHttpUrl('https://evil.example/api/cloud/callback')).toBe(false);
    expect(isLoopbackHttpUrl('http://localhost.evil.example/')).toBe(false);
    expect(isLoopbackHttpUrl('http://user:pw@localhost/')).toBe(false);
    expect(isLoopbackHttpUrl('/api/cloud/callback')).toBe(false);
  });

  it('builds the website connect URL', () => {
    const url = new URL(connectUrl('https://site.example', 'http://localhost:5173/api/cloud/callback', 's t'));
    expect(url.origin + url.pathname).toBe('https://site.example/connect');
    expect(url.searchParams.get('return')).toBe('http://localhost:5173/api/cloud/callback');
    expect(url.searchParams.get('state')).toBe('s t');
  });

  it('finds the file extension', () => {
    expect(cloudTabExtension({ format: 'GP5', file_path: 'u/x.bin' })).toBe('gp5');
    expect(cloudTabExtension({ format: null, file_path: 'u/x.musicxml' })).toBe('musicxml');
    expect(cloudTabExtension({ format: '', file_path: 'u/x' })).toBe('txt');
  });

  it('picks one recording, preferring YouTube, and ignores broken links', () => {
    expect(cloudTabMedia({ youtube_url: YT, spotify_url: SP })).toBe(YT);
    expect(cloudTabMedia({ youtube_url: null, spotify_url: SP })).toBe(SP);
    expect(cloudTabMedia({ youtube_url: 'https://youtube.com/', spotify_url: SP })).toBe(SP);
    expect(cloudTabMedia({ youtube_url: null, spotify_url: null })).toBe('');
  });

  it('turns a positive offset into a pin on bar 1', () => {
    expect(cloudSyncPoints({ sync_offset: 2.5 }, YT)).toEqual([{ bar: 0, time: 2.5 }]);
    expect(cloudSyncPoints({ sync_offset: 0 }, YT)).toEqual([]);
    expect(cloudSyncPoints({ sync_offset: -1 }, YT)).toEqual([]);
    expect(cloudSyncPoints({ sync_offset: 3 }, '')).toEqual([]);
  });

  it('summarizes and converts a row', () => {
    expect(summarizeCloudTab(row({ artist: null, youtube_url: null, spotify_url: SP }), 'song-1')).toEqual({
      id: 'tab-1',
      title: 'Night Ride',
      artist: '',
      format: 'txt',
      media: 'spotify',
      songId: 'song-1',
    });
    const input = cloudTabToSongInput(row({ title: 'A/B: "C"' }), new TextEncoder().encode('hi'));
    expect(input.tabFile).toEqual({ name: 'A B C.txt', dataBase64: 'aGk=' });
    expect(input).toMatchObject({ media: YT, cloudId: 'tab-1', syncPoints: [{ bar: 0, time: 2.5 }], tags: ['cloud'] });
  });
});

/** A stand-in for the Supabase auth, PostgREST and storage endpoints the website uses. */
class FakeSupabase {
  calls: string[] = [];
  refreshTokens = new Set<string>();
  accessTokens = new Set<string>();
  n = 0;
  rows: CloudTabRow[] = [row(), row({ id: 'tab-2', title: 'Second', file_path: 'user-1/def.gp5', format: 'gp5', youtube_url: null })];
  files: Record<string, Uint8Array> = { 'user-1/abc.txt': new TextEncoder().encode(ASCII) };
  /** The signed-in user's newest Stripe subscription row and Ko-fi membership end. */
  subscription: { status: string; current_period_end: string | null } | null = null;
  kofiEnd: string | null = null;
  /** Simulates no network: every request fails like fetch does offline. */
  offline = false;

  private issue(): Response {
    const access = `access-${++this.n}`;
    const refresh = `refresh-${this.n}`;
    this.accessTokens.add(access);
    this.refreshTokens.add(refresh);
    return Response.json({ access_token: access, refresh_token: refresh, expires_in: 3600, user: { email: 'me@example.com' } });
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    this.calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (this.offline) throw new TypeError('fetch failed');
    if (headers.get('apikey') !== 'pk') return new Response('no apikey', { status: 401 });
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
    if (url.pathname === '/auth/v1/verify') {
      return body.type === 'magiclink' && body.token_hash === 'good-hash' ? this.issue() : Response.json({ msg: 'Token has expired or is invalid' }, { status: 403 });
    }
    if (url.pathname === '/auth/v1/token') {
      // Rotation: a refresh token works once.
      if (!this.refreshTokens.delete(body.refresh_token)) return Response.json({ error_description: 'Invalid Refresh Token' }, { status: 400 });
      return this.issue();
    }
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    const token = headers.get('authorization')?.replace('Bearer ', '') ?? '';
    if (!this.accessTokens.has(token)) return Response.json({ message: 'JWT expired' }, { status: 401 });
    if (url.pathname === '/rest/v1/subscriptions') return Response.json(this.subscription ? [this.subscription] : []);
    if (url.pathname === '/rest/v1/rpc/my_kofi_membership' && init?.method === 'POST') return Response.json(this.kofiEnd);
    if (url.pathname === '/rest/v1/tabs') {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '');
      return Response.json(id ? this.rows.filter((r) => r.id === id) : this.rows);
    }
    const file = url.pathname.match(/^\/storage\/v1\/object\/authenticated\/tabs\/(.+)$/);
    if (file) {
      const data = this.files[decodeURIComponent(file[1])];
      return data ? new Response(new Blob([data as Uint8Array<ArrayBuffer>])) : Response.json({ error: 'not_found' }, { status: 400 });
    }
    return new Response('not found', { status: 404 });
  };
}

const CONFIG: CloudConfig = { siteUrl: 'https://site.example', apiUrl: 'https://api.example', apiKey: 'pk' };
const CALLBACK = 'http://localhost:5173/api/cloud/callback';

let root: string;
let fake: FakeSupabase;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fretlane-cloud-'));
  fake = new FakeSupabase();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function cloud(): Promise<FretlaneCloud> {
  const c = new FretlaneCloud(root, CONFIG, fake.fetch);
  await c.init();
  return c;
}

async function signIn(c: FretlaneCloud): Promise<void> {
  const state = new URL(c.startLogin(CALLBACK).url).searchParams.get('state')!;
  await c.finishLogin(state, 'good-hash');
}

describe('FretlaneCloud', () => {
  it('refuses a callback that is not on this computer', async () => {
    const c = await cloud();
    expect(() => c.startLogin('https://evil.example/cb')).toThrow(HttpError);
  });

  it('signs in with a state it started and saves the session privately', async () => {
    const c = await cloud();
    expect(c.status().connected).toBe(false);
    await expect(c.finishLogin('made-up-state', 'good-hash')).rejects.toThrow(/expired or was not started/);
    await signIn(c);
    expect(c.status()).toEqual({ connected: true, email: 'me@example.com', siteUrl: 'https://site.example' });
    const file = path.join(root, 'cloud.json');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ refreshToken: 'refresh-1', email: 'me@example.com' });
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it('uses a state only once and rejects a bad token', async () => {
    const c = await cloud();
    const state = new URL(c.startLogin(CALLBACK).url).searchParams.get('state')!;
    await expect(c.finishLogin(state, 'bad-hash')).rejects.toThrow(/sign-in failed/);
    await expect(c.finishLogin(state, 'good-hash')).rejects.toThrow(/expired or was not started/);
    expect(c.status().connected).toBe(false);
  });

  it('lists and downloads tabs', async () => {
    const c = await cloud();
    await signIn(c);
    expect((await c.listTabs()).map((r) => r.id)).toEqual(['tab-1', 'tab-2']);
    const tab = await c.getTab('tab-1');
    expect(new TextDecoder().decode(await c.downloadTab(tab))).toBe(ASCII);
    await expect(c.getTab('nope')).rejects.toThrow(/not in your Fretlane Cloud library/);
  });

  it('stays signed in across restarts, rotating the refresh token', async () => {
    await signIn(await cloud());
    const again = await cloud(); // a new app start: only the refresh token is on disk
    expect(again.status().connected).toBe(true);
    expect(await again.listTabs()).toHaveLength(2);
    expect(JSON.parse(await fs.readFile(path.join(root, 'cloud.json'), 'utf8')).refreshToken).toBe('refresh-2');
  });

  it('refreshes only once when requests race', async () => {
    await signIn(await cloud());
    const c = await cloud();
    await Promise.all([c.listTabs(), c.listTabs(), c.getTab('tab-1')]);
    expect(fake.calls.filter((call) => call.startsWith('POST /auth/v1/token'))).toHaveLength(1);
  });

  it('refreshes when the server rejects the access token', async () => {
    const c = await cloud();
    await signIn(c);
    fake.accessTokens.clear(); // revoked or expired early
    expect(await c.listTabs()).toHaveLength(2);
  });

  it('signs out when the refresh token stops working', async () => {
    await signIn(await cloud());
    fake.refreshTokens.clear();
    const c = await cloud();
    await expect(c.listTabs()).rejects.toThrow(/Sign in again/);
    expect(c.status().connected).toBe(false);
    await expect(fs.stat(path.join(root, 'cloud.json'))).rejects.toThrow();
  });

  it('signs out', async () => {
    const c = await cloud();
    await signIn(c);
    await c.listTabs();
    expect((await c.logout()).connected).toBe(false);
    expect(fake.calls.some((call) => call.startsWith('POST /auth/v1/logout'))).toBe(true);
    await expect(c.listTabs()).rejects.toThrow(/Not signed in/);
  });

  it('imports a cloud tab into the library once', async () => {
    const c = await cloud();
    await signIn(c);
    const lib = new Library(root);
    await lib.init();
    const tab = await c.getTab('tab-1');
    const song = await lib.add(cloudTabToSongInput(tab, await c.downloadTab(tab)));
    expect(song).toMatchObject({ title: 'Night Ride', artist: 'The Testers', youtubeId: 'dQw4w9WgXcQ', tabFormat: 'alphatex', cloudId: 'tab-1' });
    expect(song.syncPoints).toEqual([{ bar: 0, time: 2.5 }]);
    expect(lib.findByCloudId('tab-1')?.id).toBe(song.id);
    const reloaded = new Library(root);
    await reloaded.init();
    expect(reloaded.findByCloudId('tab-1')?.id).toBe(song.id);
  });
});

describe('Fretlane Premium check', () => {
  const FUTURE = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const PAST = new Date(Date.now() - 86_400_000).toISOString();

  it('is off when signed out, without asking the website', async () => {
    const c = await cloud();
    expect(await c.premium()).toMatchObject({ premium: false, reason: 'signed-out', pricingUrl: 'https://site.example/pricing' });
    expect(fake.calls).toEqual([]);
  });

  it('reads the Stripe subscription and the Ko-fi membership', async () => {
    const c = await cloud();
    await signIn(c);
    expect(await c.premium(true)).toMatchObject({ premium: false, reason: 'no-plan', email: 'me@example.com' });
    fake.subscription = { status: 'active', current_period_end: FUTURE };
    expect(await c.premium(true)).toMatchObject({ premium: true, reason: 'active', until: FUTURE });
    fake.subscription = { status: 'canceled', current_period_end: PAST };
    fake.kofiEnd = FUTURE;
    expect(await c.premium(true)).toMatchObject({ premium: true, until: FUTURE });
    expect(fake.calls).toContain('POST /rest/v1/rpc/my_kofi_membership');
    expect(fake.calls.some((call) => call.startsWith('GET /rest/v1/subscriptions?select=status,current_period_end'))).toBe(true);
  });

  it('reuses an answer for a while, and asks again when forced', async () => {
    const c = await cloud();
    await signIn(c);
    fake.subscription = { status: 'active', current_period_end: null };
    await c.premium();
    const asked = fake.calls.length;
    await c.premium();
    expect(fake.calls.length).toBe(asked);
    await c.premium(true);
    expect(fake.calls.length).toBeGreaterThan(asked);
  });

  it('keeps working offline after a recent active check, across restarts', async () => {
    let c = await cloud();
    await signIn(c);
    fake.subscription = { status: 'active', current_period_end: FUTURE };
    await c.premium(true);
    fake.offline = true;
    c = await cloud();
    expect(await c.premium()).toMatchObject({ premium: true, reason: 'offline-grace' });
  });

  it('says offline (not premium) when it never confirmed a plan', async () => {
    const c = await cloud();
    await signIn(c);
    fake.offline = true;
    expect(await c.premium(true)).toMatchObject({ premium: false, reason: 'offline' });
  });

  it('forgets the premium answer on sign-out', async () => {
    const c = await cloud();
    await signIn(c);
    fake.subscription = { status: 'active', current_period_end: FUTURE };
    await c.premium(true);
    await c.logout();
    await expect(fs.access(path.join(root, 'premium.json'))).rejects.toThrow();
    expect(await c.premium()).toMatchObject({ premium: false, reason: 'signed-out' });
  });
});
