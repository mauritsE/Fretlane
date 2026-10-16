import { describe, expect, it } from 'vitest';
import { OFFLINE_GRACE_DAYS, decidePremium, entitlementFrom, isSubscriptionActive, type EntitlementCheck } from '../shared/premium.ts';

const NOW = new Date('2026-10-15T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const PRICING = 'https://site.example/pricing';

describe('subscription rules (same as the website)', () => {
  it('counts active, trialing and past_due until the period ends', () => {
    for (const status of ['active', 'trialing', 'past_due']) {
      expect(isSubscriptionActive({ status, current_period_end: days(3) }, NOW)).toBe(true);
      expect(isSubscriptionActive({ status, current_period_end: days(-1) }, NOW)).toBe(false);
      expect(isSubscriptionActive({ status, current_period_end: null }, NOW)).toBe(true);
    }
  });

  it('counts a cancelled plan until its paid period ends', () => {
    expect(isSubscriptionActive({ status: 'canceled', current_period_end: days(3) }, NOW)).toBe(true);
    expect(isSubscriptionActive({ status: 'canceled', current_period_end: null }, NOW)).toBe(false);
    expect(isSubscriptionActive({ status: 'incomplete', current_period_end: days(3) }, NOW)).toBe(false);
    expect(isSubscriptionActive(null, NOW)).toBe(false);
  });

  it('combines Stripe and Ko-fi, reporting the later end', () => {
    expect(entitlementFrom('a@b', null, days(10), NOW)).toMatchObject({ active: true, until: days(10) });
    expect(entitlementFrom('a@b', { status: 'active', current_period_end: days(30) }, days(10), NOW)).toMatchObject({ active: true, until: days(30) });
    expect(entitlementFrom('a@b', { status: 'active', current_period_end: null }, null, NOW)).toMatchObject({ active: true, until: null });
    expect(entitlementFrom('a@b', null, days(-1), NOW)).toMatchObject({ active: false, until: null });
  });
});

describe('deciding premium', () => {
  const check = (over: Partial<EntitlementCheck> = {}): EntitlementCheck => ({ email: 'a@b', active: true, until: days(30), checkedAt: NOW.toISOString(), ...over });
  const decide = (o: Partial<Parameters<typeof decidePremium>[0]>) =>
    decidePremium({ signedIn: true, email: 'a@b', fresh: null, stored: null, pricingUrl: PRICING, now: NOW, ...o });

  it('follows a fresh answer from the website', () => {
    expect(decide({ fresh: check() })).toMatchObject({ premium: true, reason: 'active' });
    expect(decide({ fresh: check({ active: false }) })).toMatchObject({ premium: false, reason: 'no-plan' });
    expect(decide({ signedIn: false, fresh: check() })).toMatchObject({ premium: false, reason: 'signed-out' });
  });

  it('allows an offline grace period after an active check', () => {
    const at = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
    expect(decide({ stored: check({ checkedAt: at(OFFLINE_GRACE_DAYS - 1) }) })).toMatchObject({ premium: true, reason: 'offline-grace' });
    expect(decide({ stored: check({ checkedAt: at(OFFLINE_GRACE_DAYS + 1) }) })).toMatchObject({ premium: false, reason: 'offline' });
  });

  it('never past the paid period, and never for another account', () => {
    expect(decide({ stored: check({ until: days(-1) }) })).toMatchObject({ premium: false });
    expect(decide({ stored: check({ email: 'someone@else' }) })).toMatchObject({ premium: false, reason: 'offline' });
    expect(decide({ stored: check({ active: false }) })).toMatchObject({ premium: false, reason: 'no-plan' });
  });
});

describe('the server gate', () => {
  async function withServer(premiumIncluded: boolean, run: (url: string) => Promise<void>): Promise<void> {
    const { promises: fs } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { startServer } = await import('../server/app.ts');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fretlane-premium-'));
    // An unreachable cloud: nobody is signed in, so the check never needs it.
    const server = await startServer({ port: 0, host: '127.0.0.1', libraryDir: dir, premiumIncluded, cloud: { siteUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', apiKey: 'pk' } });
    try {
      await run(server.url);
    } finally {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  const written = { title: 'Mine', written: true, tabText: '\\title "Mine"\n3.6.1 |' };
  const post = (url: string) => fetch(`${url}/api/songs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(written) });

  it('refuses to create or save written songs without Premium', async () => {
    await withServer(false, async (url) => {
      expect(await (await fetch(`${url}/api/premium`)).json()).toMatchObject({ premium: false, reason: 'signed-out' });
      const res = await post(url);
      expect(res.status).toBe(402);
      expect(((await res.json()) as { error: string }).error).toMatch(/Sign in to Fretlane Cloud/);
      // Importing tabs stays free.
      expect((await fetch(`${url}/api/songs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tabText: '\\title "x"\n3.6.1 |' }) })).status).toBe(201);
    });
  });

  it('includes the editor in the App Store build', async () => {
    await withServer(true, async (url) => {
      expect(await (await fetch(`${url}/api/premium`)).json()).toMatchObject({ premium: true, reason: 'included' });
      const res = await post(url);
      expect(res.status).toBe(201);
      const song = (await res.json()) as { id: string };
      const saved = await fetch(`${url}/api/songs/${song.id}/tab`, { method: 'PUT', body: '\\title "Mine"\n5.6.1 |' });
      expect(saved.status).toBe(200);
    });
  });
});
