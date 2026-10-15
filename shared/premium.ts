/**
 * Fretlane Premium: writing tabs in the editor. It comes with the Fretlane Cloud plan on the website
 * (a Stripe subscription, or a Ko-fi membership while Stripe isn't live). The rules here mirror the
 * website's own check, `isSubscriptionActive()` in src/lib/subscription.ts and the database function
 * `public.has_active_subscription()` in mauritsE/fretlane-sync-magic.
 *
 * Fretlane is MIT-licensed, so this is a nudge, not a lock: anyone building from source can remove
 * it. See docs/premium/tab-editor-spec.md, "Paywall and entitlement".
 */

/** The columns of the website's `public.subscriptions` row the app reads (row-level security: own row only). */
export interface SubscriptionRow {
  status: string;
  current_period_end: string | null;
}

export function isSubscriptionActive(sub: SubscriptionRow | null | undefined, now = new Date()): boolean {
  if (!sub) return false;
  const end = sub.current_period_end ? new Date(sub.current_period_end) : null;
  if (['active', 'trialing', 'past_due'].includes(sub.status)) return !end || end > now;
  if (sub.status === 'canceled') return !!end && end > now;
  return false;
}

/** What the website said the last time the app asked. Stored in library/premium.json. */
export interface EntitlementCheck {
  /** The signed-in account this check belongs to. */
  email: string;
  active: boolean;
  /** When the paid period ends, if known (ISO). */
  until: string | null;
  /** When the website was asked (ISO). */
  checkedAt: string;
}

export function entitlementFrom(
  email: string,
  subscription: SubscriptionRow | null,
  kofiEnd: string | null,
  now = new Date(),
): EntitlementCheck {
  const kofiActive = !!kofiEnd && new Date(kofiEnd) > now;
  const subActive = isSubscriptionActive(subscription, now);
  const ends = [kofiActive ? kofiEnd : null, subActive ? subscription?.current_period_end ?? null : null].filter(
    (d): d is string => !!d,
  );
  return {
    email,
    active: kofiActive || subActive,
    // A Stripe subscription with no end date runs until cancelled.
    until: subActive && !subscription?.current_period_end ? null : ends.sort().at(-1) ?? null,
    checkedAt: now.toISOString(),
  };
}

/** How long a premium user can keep writing without the app reaching the website. */
export const OFFLINE_GRACE_DAYS = 14;

export type PremiumReason =
  /** The website confirmed an active plan just now. */
  | 'active'
  /**
   * This build includes the editor without a plan: the Mac App Store build, which people already
   * paid for, and where Apple doesn't allow unlocking features with a purchase made elsewhere.
   */
  | 'included'
  /** The website couldn't be reached; an earlier check said active and is recent enough. */
  | 'offline-grace'
  | 'signed-out'
  | 'no-plan'
  /** The website couldn't be reached and there is no recent enough check to go on. */
  | 'offline';

export interface PremiumStatus {
  premium: boolean;
  reason: PremiumReason;
  email: string;
  /** End of the paid period when known (ISO). */
  until: string | null;
  /** When the website last confirmed (ISO), if ever. */
  checkedAt: string | null;
  /** The website's pricing page, for the upsell. */
  pricingUrl: string;
}

/**
 * Decides from a fresh check (null when the website couldn't be reached) and the last stored one.
 * Offline, a stored active check counts for OFFLINE_GRACE_DAYS after it was made, but never past
 * the end of the paid period it reported.
 */
export function decidePremium(opts: {
  signedIn: boolean;
  email: string;
  fresh: EntitlementCheck | null;
  stored: EntitlementCheck | null;
  pricingUrl: string;
  now?: Date;
}): PremiumStatus {
  const now = opts.now ?? new Date();
  const base = { email: opts.email, pricingUrl: opts.pricingUrl };
  if (!opts.signedIn) return { ...base, premium: false, reason: 'signed-out', until: null, checkedAt: null };
  if (opts.fresh) {
    return {
      ...base,
      premium: opts.fresh.active,
      reason: opts.fresh.active ? 'active' : 'no-plan',
      until: opts.fresh.until,
      checkedAt: opts.fresh.checkedAt,
    };
  }
  const s = opts.stored && opts.stored.email === opts.email ? opts.stored : null;
  if (s?.active) {
    const graceEnd = new Date(new Date(s.checkedAt).getTime() + OFFLINE_GRACE_DAYS * 86_400_000);
    const paidEnd = s.until ? new Date(s.until) : null;
    const ok = graceEnd > now && (!paidEnd || paidEnd > now);
    return { ...base, premium: ok, reason: ok ? 'offline-grace' : 'offline', until: s.until, checkedAt: s.checkedAt };
  }
  return { ...base, premium: false, reason: s ? 'no-plan' : 'offline', until: s?.until ?? null, checkedAt: s?.checkedAt ?? null };
}
