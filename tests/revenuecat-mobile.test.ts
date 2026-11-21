import { beforeEach, describe, expect, it } from 'vitest';
import { failure, parsePeriod, revenueCatMobile, tierOf } from '../revenuecat-mobile';
import { Platform, opened } from './stubs/react-native';
import { info, store } from './stubs/purchases';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const make = (over = {}) =>
  revenueCatMobile({ iosKey: 'appl_x', androidKey: 'goog_x', plans: [{ id: 'yearly', tier: 'premium', package: 'ANNUAL' }, { id: 'monthly', tier: 'premium', package: 'MONTHLY' }], ...over });

beforeEach(() => { store.reset(); Platform.OS = 'ios'; opened.length = 0; });

describe('revenueCatMobile provider', () => {
  it('is not ready on web or without a key', () => {
    Platform.OS = 'web';
    expect(make().ready).toBe(false);
    Platform.OS = 'android';
    expect(make({ androidKey: '' }).ready).toBe(false);
    expect(make().ready).toBe(true);
  });

  it('refuses a RevenueCat test_ key in a release build instead of letting the SDK close the app', async () => {
    const errors: string[] = [];
    const p = make({ iosKey: 'test_abc', onError: (where: string) => errors.push(where) });
    expect(p.ready).toBe(false);
    expect(errors).toEqual(['payments:test-key']);
    await p.start(U1);
    expect(store.configured).toEqual([]); // the SDK never sees the key
    // In a development build the Test Store key is fine.
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    try {
      expect(make({ iosKey: 'test_abc' }).ready).toBe(true);
    } finally {
      delete (globalThis as { __DEV__?: boolean }).__DEV__;
    }
  });

  it('does not set the store up on an anonymous id at a sign-out before anyone signed in', async () => {
    const p = make();
    await p.start(null); // the app still restoring the session, or signed out
    expect(store.configured).toEqual([]);
    await p.start(U1); // the real account: set up on it directly, no logIn (a network call) needed
    expect(store.configured).toEqual([{ apiKey: 'appl_x', appUserID: U1 }]);
    expect(store.user).toBe(U1);
    // Signed out for good: an anonymous id is set up the moment something needs the store.
    const q = make();
    await q.start(null);
    expect(await q.currentTier()).toBe('free');
    expect(store.configured).toHaveLength(2);
  });

  it('loads plans in the app order with store prices, period and trial', async () => {
    const p = make();
    await p.start(U1);
    const plans = await p.loadPlans();
    expect(plans.map((x) => [x.id, x.priceString, x.period?.unit, x.trialDays])).toEqual([
      ['yearly', '$39.99', 'YEAR', 7],
      ['monthly', '$6.99', 'MONTH', null],
    ]);
  });

  it('keeps the trial as the store sets it, so a 1-month trial is not called 30 days', async () => {
    const yearly = store.packages[0]!;
    const intro = yearly.product.introPrice;
    yearly.product.introPrice = { price: 0, periodUnit: 'MONTH', periodNumberOfUnits: 1 };
    try {
      const p = make();
      await p.start(U1);
      const [plan] = await p.loadPlans();
      expect(plan!.trial).toEqual({ unit: 'MONTH', count: 1 });
    } finally {
      yearly.product.introPrice = intro;
    }
    const p = make();
    await p.start(U1);
    expect((await p.loadPlans())[0]!.trial).toEqual({ unit: 'WEEK', count: 1 });
  });

  it('hides the trial on iPhone when the person already used it', async () => {
    store.eligible = 1;
    const p = make();
    await p.start(U1);
    expect((await p.loadPlans())[0]!.trialDays).toBeNull();
    expect((await p.loadPlans())[0]!.trial).toBeNull();
  });

  it('leaves out plans the offering does not have', async () => {
    const p = make({ plans: [{ id: 'weekly', tier: 'premium', package: 'WEEKLY' }, { id: 'monthly', tier: 'premium', package: '$rc_monthly' }] });
    await p.start(U1);
    expect((await p.loadPlans()).map((x) => x.id)).toEqual(['monthly']);
  });

  it('buys as the signed-in account and reports the new tier', async () => {
    const p = make();
    await p.start(null);
    const [yearly] = await p.loadPlans();
    expect(await p.buy(yearly!, U2)).toEqual({ ok: true, tier: 'premium' });
    expect(store.user).toBe(U2);
  });

  it('refuses to buy when it cannot confirm the account with the store', async () => {
    const p = make();
    await p.start(null);
    const [yearly] = await p.loadPlans();
    store.failLogIn = true;
    const r = await p.buy(yearly!, U2);
    expect(r.ok).toBe(false);
  });

  it('turns store errors into friendly results', () => {
    expect(failure({ userCancelled: true })).toEqual({ ok: false, cancelled: true, message: '' });
    expect(failure({ code: '20' })).toMatchObject({ pending: true });
    expect(failure({ code: '10' }).ok).toBe(false);
    expect((failure(new Error('x')) as { message: string }).message).toMatch(/try again/);
  });

  it('picks the highest active tier', () => {
    const tiers = ['free', 'plus', 'pro'];
    expect(tierOf(info('plus', 'pro'), tiers)).toBe('pro');
    expect(tierOf(info('pro_access'), tiers, { pro: 'pro_access' })).toBe('pro');
    expect(tierOf(info('other'), tiers)).toBe('free');
    expect(tierOf(null, tiers)).toBe('free');
  });

  it('parses store periods', () => {
    expect(parsePeriod('P3M')).toEqual({ unit: 'MONTH', count: 3 });
    expect(parsePeriod(null)).toBeNull();
  });

  it('sends Android codes to the Play Store', async () => {
    Platform.OS = 'android';
    await make().redeemCode!(' ab c ');
    expect(opened).toEqual(['https://play.google.com/redeem?code=ab%20c']);
  });

  it("shows Apple's manage sheet in the app on iPhone, only once the store is set up", async () => {
    const p = make();
    expect(await p.openManage!()).toBe(false);
    await p.start(U1);
    store.customer = { entitlements: { active: { premium: { identifier: 'premium', productIdentifier: 'm', expirationDate: '2026-12-12T10:00:00Z', willRenew: true } } } } as unknown as typeof store.customer;
    expect(await p.openManage!()).toBe(true);
    expect(store.manageShown).toBe(1);
    expect(store.synced).toBe(1); // pushed to RevenueCat when the sheet closed
    expect(p.renewal!()?.willRenew).toBe(true);
  });

  it("never sends this phone's purchases to the store while it is on someone else", async () => {
    const p = make();
    await p.start(U1);
    store.failLogIn = true;
    expect(await p.openManage!(U2)).toBe(true);
    expect(store.manageShown).toBe(1);
    expect(store.synced).toBe(0);
    store.failLogIn = false;
    await p.openManage!(U1);
    expect(store.synced).toBe(1);
  });

  it("never sends this phone's purchases to the last person after a sign-out that didn't reach the store", async () => {
    const p = make();
    await p.start(U1);
    store.failLogOut = true;
    await p.start(null); // the log-out fails quietly; the store is still on U1
    expect(await p.openManage!(null)).toBe(true);
    expect(store.manageShown).toBe(1);
    expect(store.synced).toBe(0);
    store.failLogOut = false;
    await p.openManage!(null);
    expect(store.synced).toBe(1);
    expect(store.user?.startsWith('$RCAnonymousID:')).toBe(true);
  });

  it('says when the store could not take the renewal payment (billing issue)', async () => {
    const p = make();
    await p.start(U1);
    const premium = (billingIssueDetectedAt: string | null) => ({ entitlements: { active: { premium: { identifier: 'premium', productIdentifier: 'm', expirationDate: '2026-11-12T10:00:00Z', willRenew: true, billingIssueDetectedAt } } } }) as unknown as typeof store.customer;
    store.customer = premium('2026-11-10T10:00:00Z');
    await p.currentTier();
    expect(p.renewal!()).toMatchObject({ willRenew: true, billingIssue: true });
    store.customer = premium(null);
    await p.currentTier();
    expect(p.renewal!()?.billingIssue).toBeUndefined();
  });

  it('reports when the paid tier ends and whether it renews', async () => {
    const p = make();
    await p.start(U1);
    await p.currentTier();
    expect(p.renewal!()).toBeNull();
    const premium = (willRenew: boolean) => ({ entitlements: { active: { premium: { identifier: 'premium', productIdentifier: 'hringnring_monthly', expirationDate: '2026-11-12T10:00:00Z', willRenew } } } }) as unknown as typeof store.customer;
    store.customer = premium(true);
    await p.currentTier();
    expect(p.renewal!()).toEqual({ until: '2026-11-12T10:00:00.000Z', willRenew: true, productId: 'hringnring_monthly' });
    store.customer = premium(false); // cancelled: still Premium until the date, then it ends
    await p.currentTier();
    expect(p.renewal!()).toEqual({ until: '2026-11-12T10:00:00.000Z', willRenew: false, productId: 'hringnring_monthly' });
  });

  it('says when the subscription is in its free trial', async () => {
    const p = make();
    await p.start(U1);
    const premium = (periodType: string) => ({ entitlements: { active: { premium: { identifier: 'premium', productIdentifier: 'pal_premium_monthly', expirationDate: '2026-11-19T10:00:00Z', willRenew: true, periodType } } } }) as unknown as typeof store.customer;
    store.customer = premium('TRIAL');
    await p.currentTier();
    expect(p.renewal!()?.trial).toBe(true);
    store.customer = premium('NORMAL');
    await p.currentTier();
    expect(p.renewal!()?.trial).toBe(false);
    // An SDK that doesn't say which period it is: unknown, not "no trial".
    store.customer = premium('');
    await p.currentTier();
    expect(p.renewal!()).not.toHaveProperty('trial');
  });

  it('leaves Android to the Play Store page', async () => {
    Platform.OS = 'android';
    const p = make();
    await p.start(U1);
    expect(await p.openManage!()).toBe(false);
    expect(store.manageShown).toBe(0);
  });

  it("drops the saved customer info and asks the store again", async () => {
    const p = make();
    await p.refresh!();
    expect(store.cacheDropped).toBe(0);
    await p.start(U1);
    await p.currentTier();
    store.customer = { entitlements: { active: { premium: { identifier: 'premium', productIdentifier: 'm', expirationDate: '2026-12-12T10:00:00Z', willRenew: true } } } } as unknown as typeof store.customer;
    await p.refresh!();
    expect(store.cacheDropped).toBe(1);
    expect(p.renewal!()?.willRenew).toBe(true);
  });

  it('finds an App Store promotional offer by id and buys it signed', async () => {
    const p = make();
    await p.start(U1);
    const offer = await p.loadOffer!('monthly_stay50');
    expect(offer).toMatchObject({ id: 'monthly_stay50', priceString: '$3.49', cycles: 3, period: { unit: 'MONTH', count: 1 }, plan: { id: 'monthly' } });
    expect(await p.loadOffer!('nope')).toBeNull();
    expect(await p.buyOffer!(offer!, U1)).toEqual({ ok: true, tier: 'premium' });
    expect(store.discountedBought).toBe('gp_monthly:monthly_stay50');
    store.canSign = false; // no In-App Purchase key in RevenueCat
    expect(await p.buyOffer!(offer!, U1)).toMatchObject({ ok: false, cancelled: false });
    Platform.OS = 'android';
    expect(await make().loadOffer!('monthly_stay50')).toBeNull();
  });
});
