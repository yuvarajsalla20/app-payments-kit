import { beforeEach, describe, expect, it } from 'vitest';
import { failure, parsePeriod, revenueCat, tierOf } from '../src/revenuecat';
import { Platform, opened } from './stubs/react-native';
import { info, store } from './stubs/purchases';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const make = (over = {}) =>
  revenueCat({ iosKey: 'appl_x', androidKey: 'goog_x', plans: [{ id: 'yearly', tier: 'premium', package: 'ANNUAL' }, { id: 'monthly', tier: 'premium', package: 'MONTHLY' }], ...over });

beforeEach(() => { store.reset(); Platform.OS = 'ios'; opened.length = 0; });

describe('revenueCat provider', () => {
  it('is not ready on web or without a key', () => {
    Platform.OS = 'web';
    expect(make().ready).toBe(false);
    Platform.OS = 'android';
    expect(make({ androidKey: '' }).ready).toBe(false);
    expect(make().ready).toBe(true);
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

  it('hides the trial on iPhone when the person already used it', async () => {
    store.eligible = 1;
    const p = make();
    await p.start(U1);
    expect((await p.loadPlans())[0]!.trialDays).toBeNull();
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
});
