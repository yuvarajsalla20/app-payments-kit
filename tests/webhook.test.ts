import { describe, expect, it } from 'vitest';
import { accountIds, isNewer, plan, sameSecret, type StoredRow } from '../supabase/functions/payments-webhook/core';
import { fromRevenueCat, type RcEvent } from '../supabase/functions/payments-webhook/revenuecat';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-07T12:00:00Z');
const later = Date.parse('2026-12-07T12:00:00Z');
const tiers = ['free', 'premium'];
const ev = (over: Partial<RcEvent>): RcEvent => ({ id: 'e1', type: 'INITIAL_PURCHASE', app_user_id: U1, entitlement_ids: ['premium'], expiration_at_ms: later, event_timestamp_ms: now.getTime(), store: 'APP_STORE', environment: 'PRODUCTION', ...over });

describe('RevenueCat events', () => {
  it('a purchase turns the tier on until the period ends', () => {
    const c = fromRevenueCat(ev({ period_type: 'TRIAL' }), tiers, now)!;
    expect(c).toMatchObject({ tier: 'premium', activeUntil: new Date(later).toISOString(), status: 'trial', willRenew: true });
  });
  it('a product with no paid entitlement changes nothing', () => {
    expect(fromRevenueCat(ev({ entitlement_ids: [] }), tiers, now)).toBeNull();
    expect(fromRevenueCat(ev({ entitlement_ids: ['gold'] }), tiers, now)).toBeNull();
    expect(fromRevenueCat(ev({ type: 'TEST' }), tiers, now)).toBeNull();
  });
  it('picks the highest tier named', () => {
    expect(fromRevenueCat(ev({ entitlement_ids: ['plus', 'pro'] }), ['free', 'plus', 'pro'], now)!.tier).toBe('pro');
  });
  it('a cancel keeps access to the end; a refund ends it now', () => {
    expect(fromRevenueCat(ev({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' }), tiers, now)).toMatchObject({ status: 'cancelled', willRenew: false, activeUntil: new Date(later).toISOString() });
    expect(fromRevenueCat(ev({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' }), tiers, now)).toMatchObject({ status: 'refunded', activeUntil: now.toISOString() });
  });
  it('a billing problem keeps access through the grace period; expiry ends it', () => {
    expect(fromRevenueCat(ev({ type: 'BILLING_ISSUE' }), tiers, now)).toMatchObject({ status: 'grace', activeUntil: new Date(later).toISOString() });
    expect(fromRevenueCat(ev({ type: 'EXPIRATION' }), tiers, now)).toMatchObject({ status: 'expired', activeUntil: now.toISOString() });
  });
});

describe('plan', () => {
  const stored = (over: Partial<StoredRow> = {}): StoredRow => ({ user_id: U1, tier: 'premium', active_until: null, will_renew: null, event_at: null, ...over });

  it('writes one row per real account id', () => {
    const c = fromRevenueCat(ev({ aliases: ['$RCAnonymousID:abc', U1] }), tiers, now)!;
    const rows = plan(c, [], now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: U1, tier: 'premium', status: 'active', provider: 'revenuecat', environment: 'PRODUCTION' });
  });

  it('skips an event older than the one already applied', () => {
    const c = fromRevenueCat(ev({ type: 'EXPIRATION', event_timestamp_ms: now.getTime() - 1000 }), tiers, now)!;
    expect(plan(c, [stored({ event_at: now.toISOString() })], now)).toEqual([]);
  });

  it('keeps the stored end date and renew flag when the event has none', () => {
    const c = fromRevenueCat(ev({ type: 'BILLING_ISSUE', expiration_at_ms: null }), tiers, now)!;
    const [r] = plan(c, [stored({ active_until: '2026-11-20T00:00:00.000Z', will_renew: true })], now);
    expect(r).toMatchObject({ status: 'grace', active_until: '2026-11-20T00:00:00.000Z', will_renew: true });
  });

  it('a transfer ends the old account and gives the new one its end date', () => {
    const c = fromRevenueCat(ev({ type: 'TRANSFER', transferred_from: [U1], transferred_to: [U2] }), tiers, now)!;
    const rows = plan(c, [stored({ active_until: '2027-01-01T00:00:00.000Z' })], now);
    expect(rows.map((r) => [r.user_id, r.status, r.active_until])).toEqual([
      [U1, 'expired', now.toISOString()],
      [U2, 'active', '2027-01-01T00:00:00.000Z'],
    ]);
  });
});

describe('helpers', () => {
  it('compares secrets', () => {
    expect(sameSecret('Bearer abc', 'Bearer abc')).toBe(true);
    expect(sameSecret('Bearer abc', 'Bearer abd')).toBe(false);
    expect(sameSecret('', '')).toBe(false);
  });
  it('keeps only account ids and checks event order', () => {
    expect(accountIds([U1, 'x', U1, null])).toEqual([U1]);
    expect(isNewer(2, '1970-01-01T00:00:00.001Z')).toBe(true);
    expect(isNewer(0, null)).toBe(true);
  });
});
