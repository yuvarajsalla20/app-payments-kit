import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaymentsKit, type PaymentProvider, type ServerSubscription, type TierState } from '../src';
import { Platform, appState, opened } from './stubs/react-native';

const flush = () => new Promise((r) => setTimeout(r, 0));
const fakeProvider = (over: Partial<PaymentProvider> = {}): PaymentProvider & { emit: (t: string) => void } => {
  let listener: (t: string) => void = () => undefined;
  return {
    name: 'fake',
    ready: true,
    start: vi.fn(async () => {}),
    loadPlans: async () => [],
    buy: vi.fn(async () => ({ ok: true as const, tier: 'premium' })),
    restore: async () => ({ ok: true as const, tier: 'free' }),
    currentTier: async () => 'free',
    onTierChange: (cb) => { listener = cb; return () => { listener = () => undefined; }; },
    emit: (t) => listener(t),
    ...over,
  };
};
const row = (tier: string, days: number): ServerSubscription => ({ tier, activeUntil: new Date(Date.now() + days * 86_400_000).toISOString(), status: 'active', willRenew: true, provider: 'revenuecat', productId: 'x' });

beforeEach(() => { Platform.OS = 'ios'; appState.listeners.clear(); });

describe('createPaymentsKit', () => {
  it('picks the provider for this platform, else the default', () => {
    const ios = fakeProvider(), web = fakeProvider({ name: 'web' });
    expect(createPaymentsKit({ providers: { ios, default: web } }).provider).toBe(ios);
    Platform.OS = 'android';
    expect(createPaymentsKit({ providers: { ios, default: web } }).provider).toBe(web);
    expect(createPaymentsKit({ providers: { ios } }).ready).toBe(false);
  });

  it('says purchases are not open when no provider is ready', async () => {
    Platform.OS = 'web';
    const kit = createPaymentsKit({ providers: { ios: fakeProvider() } });
    expect(await kit.loadPlans()).toEqual([]);
    expect(await kit.buy({} as never)).toMatchObject({ ok: false, cancelled: false });
  });

  it('offers a code box only when the provider can take codes', () => {
    expect(createPaymentsKit({ providers: { ios: fakeProvider({ redeemCode: async () => {} }) } }).canRedeemCode).toBe(true);
    expect(createPaymentsKit({ providers: { ios: fakeProvider() } }).canRedeemCode).toBe(false);
    expect(createPaymentsKit({ providers: { ios: fakeProvider({ ready: false, redeemCode: async () => {} }) } }).canRedeemCode).toBe(false);
  });

  it('books purchases to the account given to start()', async () => {
    const p = fakeProvider();
    const kit = createPaymentsKit({ providers: { ios: p } });
    await kit.start('u1');
    await kit.buy({ id: 'yearly' } as never);
    expect(p.buy).toHaveBeenCalledWith({ id: 'yearly' }, 'u1');
  });

  it('watch() takes the highest of store, server and tester, and re-checks when the app returns', async () => {
    const p = fakeProvider();
    let server: ServerSubscription | null = null;
    const kit = createPaymentsKit({ providers: { ios: p }, tiers: ['free', 'plus', 'pro'], backend: { read: async () => server }, tester: true });
    const seen: TierState[] = [];
    const stop = kit.watch('u1', (s) => seen.push(s));
    await flush();
    expect(seen.at(-1)).toMatchObject({ tier: 'free', source: 'free' });

    p.emit('plus');
    expect(seen.at(-1)).toMatchObject({ tier: 'plus', source: 'store' });

    server = row('pro', 30);
    appState.listeners.forEach((l) => l('active'));
    await flush();
    expect(seen.at(-1)).toMatchObject({ tier: 'pro', source: 'account' });

    server = row('pro', -1); // ended yesterday
    appState.listeners.forEach((l) => l('active'));
    await flush();
    expect(seen.at(-1)?.tier).toBe('free');

    await kit.setTesterTier('pro');
    expect(seen.at(-1)).toMatchObject({ tier: 'pro', source: 'tester' });
    stop();
    expect(appState.listeners.size).toBe(0);
  });

  it("watch() passes the store's renewal date only while the tier comes from the store", async () => {
    const ends = { until: '2026-11-12T10:00:00.000Z', willRenew: false, productId: 'monthly' };
    const p = fakeProvider({ renewal: () => ends });
    const kit = createPaymentsKit({ providers: { ios: p }, tester: true });
    const seen: TierState[] = [];
    const stop = kit.watch(null, (s) => seen.push(s));
    await flush();
    expect(seen.at(-1)).toMatchObject({ tier: 'free', renewal: null });
    p.emit('premium');
    expect(seen.at(-1)).toMatchObject({ tier: 'premium', source: 'store', renewal: ends });
    p.emit('free');
    await kit.setTesterTier('premium');
    expect(seen.at(-1)).toMatchObject({ source: 'tester', renewal: null });
    await kit.setTesterTier(null);
    stop();
  });

  it('watch() says nothing until the server row has been read once', async () => {
    let answer: (row: ServerSubscription | null) => void = () => undefined;
    const backend = { read: () => new Promise<ServerSubscription | null>((r) => { answer = r; }) };
    const kit = createPaymentsKit({ providers: { ios: fakeProvider() }, tiers: ['free', 'premium'], backend });
    const seen: TierState[] = [];
    kit.watch('u1', (s) => seen.push(s));
    await flush();
    expect(seen).toEqual([]); // not "free" while the answer is still on its way
    answer(row('premium', 30));
    await flush();
    expect(seen.at(-1)).toMatchObject({ tier: 'premium', source: 'account' });
    // A failed read still answers (free), so the app is never stuck loading.
    const failing = createPaymentsKit({ providers: { ios: fakeProvider() }, tiers: ['free', 'premium'], backend: { read: async () => { throw new Error('offline'); } } });
    const seen2: TierState[] = [];
    failing.watch('u1', (s) => seen2.push(s));
    await flush();
    expect(seen2.at(-1)?.tier).toBe('free');
    // No account, or no backend: answers at once.
    const seen3: TierState[] = [];
    createPaymentsKit({ providers: { ios: fakeProvider() }, tiers: ['free', 'premium'], backend }).watch(null, (s) => seen3.push(s));
    await flush();
    expect(seen3.at(-1)?.tier).toBe('free');
  });

  it('ignores the tester switch unless tester is on, and remembers it when on', async () => {
    const saved: Record<string, string> = {};
    const storage = { getItem: async (k: string) => saved[k] ?? null, setItem: async (k: string, v: string) => void (saved[k] = v) };
    const off = createPaymentsKit({ providers: {}, tester: false, testerStorage: storage });
    await off.setTesterTier('premium');
    expect(await off.getTesterTier()).toBeNull();

    const on = createPaymentsKit({ providers: {}, tester: true, testerStorage: storage });
    await on.setTesterTier('premium');
    const again = createPaymentsKit({ providers: {}, tester: true, testerStorage: storage });
    expect(await again.getTesterTier()).toBe('premium');
    await again.setTesterTier('gold');
    expect(await again.getTesterTier()).toBeNull();
  });

  it('opens the store manage page', () => {
    expect(createPaymentsKit({ providers: {} }).manageUrl()).toContain('apps.apple.com');
  });

  it("opens the provider's in-app manage screen, and the manage page when it has none or it fails", async () => {
    opened.length = 0;
    const sheet = vi.fn(async () => true);
    await createPaymentsKit({ providers: { ios: fakeProvider({ openManage: sheet }) } }).openManage();
    expect(sheet).toHaveBeenCalledOnce();
    expect(opened).toEqual([]);

    await createPaymentsKit({ providers: { ios: fakeProvider({ openManage: async () => false }) } }).openManage();
    const errors: string[] = [];
    const broken = fakeProvider({ openManage: async () => { throw new Error('old iOS'); } });
    await createPaymentsKit({ providers: { ios: broken }, onError: (where) => errors.push(where) }).openManage();
    await createPaymentsKit({ providers: { ios: fakeProvider() } }).openManage();
    expect(opened).toEqual(Array(3).fill('https://apps.apple.com/account/subscriptions'));
    expect(errors).toEqual(['payments:manage']);
  });

  it('asks the store again after the in-app manage sheet closes, then once more a little later', async () => {
    vi.useFakeTimers();
    try {
      let willRenew = false;
      const refresh = vi.fn(async () => {});
      const p = fakeProvider({ openManage: async () => true, refresh, currentTier: async () => 'premium', renewal: () => ({ until: '2026-12-12T10:00:00.000Z', willRenew, productId: 'monthly' }) });
      const kit = createPaymentsKit({ providers: { ios: p } });
      const seen: TierState[] = [];
      const stop = kit.watch(null, (s) => seen.push(s));
      await vi.advanceTimersByTimeAsync(0);
      expect(seen.at(-1)?.renewal?.willRenew).toBe(false);
      willRenew = true; // turned back on in Apple's sheet
      await kit.openManage();
      await vi.advanceTimersByTimeAsync(0);
      expect(refresh).toHaveBeenCalledOnce();
      expect(seen.at(-1)?.renewal?.willRenew).toBe(true);
      await vi.advanceTimersByTimeAsync(50_000);
      expect(refresh).toHaveBeenCalledTimes(4);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a newer refresh replaces the later checks of an older one', async () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn(async () => {});
      const kit = createPaymentsKit({ providers: { ios: fakeProvider({ refresh }) } });
      await kit.refresh();
      await kit.refresh();
      expect(refresh).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(50_000);
      expect(refresh).toHaveBeenCalledTimes(5); // 2 now, then 3 later (not 6)
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads and buys a discount for subscribers only where the provider has one', async () => {
    const plan = { id: 'monthly', tier: 'premium', priceString: '$3.99', price: 3.99, currency: 'USD', period: { unit: 'MONTH' as const, count: 1 }, trialDays: null };
    const offer = { id: 'stay', plan, priceString: '$1.99', price: 1.99, period: { unit: 'MONTH' as const, count: 1 }, cycles: 3 };
    const buyOffer = vi.fn(async () => ({ ok: true as const, tier: 'premium' }));
    const kit = createPaymentsKit({ providers: { ios: fakeProvider({ loadOffer: async (id) => (id === 'stay' ? offer : null), buyOffer }) } });
    expect(await kit.loadOffer('stay')).toEqual(offer);
    expect(await kit.loadOffer('other')).toBeNull();
    expect(await kit.loadOffer('')).toBeNull();
    await kit.start('u1');
    expect(await kit.buyOffer(offer)).toEqual({ ok: true, tier: 'premium' });
    expect(buyOffer).toHaveBeenCalledWith(offer, 'u1');
    const errors: string[] = [];
    const broken = createPaymentsKit({ providers: { ios: fakeProvider({ loadOffer: async () => { throw new Error('x'); } }) }, onError: (w) => errors.push(w) });
    expect(await broken.loadOffer('stay')).toBeNull();
    expect(errors).toEqual(['payments:offer']);
    expect(await createPaymentsKit({ providers: { ios: fakeProvider() } }).loadOffer('stay')).toBeNull();
  });
});
