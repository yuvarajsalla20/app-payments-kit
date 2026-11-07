import { beforeEach, describe, expect, it } from 'vitest';
import { revenueCatWeb, webFailure } from '../revenuecat-web';
import { web } from './stubs/purchases-web';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const make = (over = {}) =>
  revenueCatWeb({ apiKey: 'rcb_x', plans: [{ id: 'yearly', tier: 'premium', package: 'ANNUAL' }, { id: 'monthly', tier: 'premium', package: 'MONTHLY' }], ...over });

beforeEach(() => web.clear());

describe('revenueCatWeb provider', () => {
  it('is not ready without a key, and sells nothing then', async () => {
    const p = make({ apiKey: '' });
    expect(p.ready).toBe(false);
    await p.start(U1);
    expect(web.configured).toEqual([]);
    expect(await p.loadPlans()).toEqual([]);
    expect((await p.buy({ id: 'x', tier: 'premium', priceString: '', price: 0, currency: 'USD', period: null, trialDays: null }, U1)).ok).toBe(false);
  });

  it('ties RevenueCat to the signed-in account and follows account changes', async () => {
    const p = make();
    await p.start(U1);
    expect(web.configured).toEqual([{ apiKey: 'rcb_x', appUserId: U1 }]);
    await p.start(U2);
    expect(web.user).toBe(U2);
    expect(web.configured).toHaveLength(1);
  });

  it('loads plans in the app order with Web Billing prices, period and trial', async () => {
    const p = make();
    await p.start(U1);
    const plans = await p.loadPlans();
    expect(plans.map((x) => [x.id, x.priceString, x.price, x.currency, x.period, x.trialDays])).toEqual([
      ['yearly', '$39.99', 39.99, 'USD', { unit: 'YEAR', count: 1 }, 7],
      ['monthly', '$6.99', 6.99, 'USD', { unit: 'MONTH', count: 1 }, null],
    ]);
  });

  it('uses a named offering and leaves out plans it does not have', async () => {
    const p = make({ offering: 'alt' });
    await p.start(U1);
    expect((await p.loadPlans()).map((x) => x.id)).toEqual(['monthly']);
  });

  it('shows no plans while signed out', async () => {
    const p = make();
    await p.start(U1);
    await p.start(null);
    expect(await p.loadPlans()).toEqual([]);
  });

  it('buys for the signed-in account, passes the email and tells listeners', async () => {
    const p = make({ customerEmail: async () => 'parent@example.com' });
    await p.start(U1);
    const seen: string[] = [];
    const stop = p.onTierChange((t) => seen.push(t));
    const [yearly] = await p.loadPlans();
    expect(await p.buy(yearly!, U1)).toEqual({ ok: true, tier: 'premium' });
    expect(web.bought).toEqual([{ pkg: yearly!.native, email: 'parent@example.com', user: U1 }]);
    expect(seen).toEqual(['premium']);
    expect(p.manageUrl!()).toBe('https://pay.rev.cat/manage');
    stop();
    await p.currentTier();
    expect(seen).toEqual(['premium']);
  });

  it('refuses to buy for anyone but the signed-in account', async () => {
    const p = make();
    await p.start(U1);
    const [yearly] = await p.loadPlans();
    expect((await p.buy(yearly!, U2)).ok).toBe(false);
    expect((await p.buy(yearly!, null)).ok).toBe(false);
    await p.start(null);
    expect((await p.buy(yearly!, U1)).ok).toBe(false);
    expect(web.bought).toEqual([]);
  });

  it('turns checkout errors into friendly results', async () => {
    const p = make();
    await p.start(U1);
    const [yearly] = await p.loadPlans();
    web.fail = 1;
    expect(await p.buy(yearly!, U1)).toEqual({ ok: false, cancelled: true, message: '' });
    web.fail = 20;
    expect(await p.buy(yearly!, U1)).toMatchObject({ ok: false, pending: true });
    expect(webFailure({ errorCode: 10 }).message).toMatch(/internet/);
    expect(webFailure({ errorCode: 6 }).message).toMatch(/already/);
    expect(webFailure(new Error('boom'))).toMatchObject({ ok: false, cancelled: false });
  });

  it('restore and currentTier read the account, highest tier first', async () => {
    const p = make({ tiers: ['free', 'plus', 'pro'] });
    expect(await p.currentTier()).toBe('free');
    await p.start(U1);
    web.active = ['plus', 'pro'];
    expect(await p.restore(U1)).toEqual({ ok: true, tier: 'pro' });
    expect(await p.currentTier()).toBe('pro');
  });

  it('has no code box on the web', () => {
    expect(make().redeemCode).toBeUndefined();
  });
});
