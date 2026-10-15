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
