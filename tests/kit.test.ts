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
      expect(refresh).toHaveBeenCalledTimes(11); // nothing changed while the sheet was open: every 2 s, then less often
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the later checks when someone else signs in or out", async () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn(async () => {});
      const kit = createPaymentsKit({ providers: { ios: fakeProvider({ openManage: async () => true, refresh }) } });
      await kit.start('u1');
      await kit.openManage();
      expect(refresh).toHaveBeenCalledOnce();
      await kit.stop();
      await vi.advanceTimersByTimeAsync(50_000);
      expect(refresh).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops checking as soon as the store shows the change made in the manage sheet', async () => {
    vi.useFakeTimers();
    try {
      let willRenew = true;
      let checks = 0;
      // Apple passes the cancel on only by the third check after the sheet closes.
      const refresh = vi.fn(async () => { checks += 1; if (checks === 3) willRenew = false; });
      const p = fakeProvider({ openManage: async () => true, refresh, currentTier: async () => 'premium', renewal: () => ({ until: '2026-12-12T10:00:00.000Z', willRenew, productId: 'monthly' }) });
      const kit = createPaymentsKit({ providers: { ios: p } });
      await kit.openManage();
      await vi.advanceTimersByTimeAsync(50_000);
      expect(refresh).toHaveBeenCalledTimes(3); // now, at 2 s and at 4 s, then no more
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps reading the server row for the whole window after the store shows the change (the webhook lands later)", async () => {
    vi.useFakeTimers();
    try {
      let willRenew = true;
      let checks = 0;
      const refresh = vi.fn(async () => { checks += 1; if (checks === 1) willRenew = false; });
      const read = vi.fn(async () => null);
      const p = fakeProvider({ openManage: async () => true, refresh, currentTier: async () => 'premium', renewal: () => ({ until: '2026-12-12T10:00:00.000Z', willRenew, productId: 'monthly' }) });
      const kit = createPaymentsKit({ providers: { ios: p }, backend: { read } });
      const stop = kit.watch('u1', () => undefined);
      await vi.advanceTimersByTimeAsync(0);
      read.mockClear();
      await kit.openManage();
      await vi.advanceTimersByTimeAsync(50_000);
      expect(refresh).toHaveBeenCalledTimes(1); // the store changed at the first look: not asked again
      expect(read).toHaveBeenCalledTimes(11); // the row: right away, then at every later check
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps checking when only the end date moves, and stops once auto-renew itself changes', async () => {
    vi.useFakeTimers();
    try {
      let willRenew = false;
      let until = '2026-12-12T10:00:00.000Z';
      let checks = 0;
      // The first check after the sheet brings a fresher date but the old auto-renew; Apple passes the renew on by the fourth.
      const refresh = vi.fn(async () => { checks += 1; if (checks === 1) until = '2026-12-12T11:00:00.000Z'; if (checks === 4) willRenew = true; });
      const p = fakeProvider({ openManage: async () => true, refresh, currentTier: async () => 'premium', renewal: () => ({ until, willRenew, productId: 'monthly' }) });
      const kit = createPaymentsKit({ providers: { ios: p } });
      await kit.openManage();
      await vi.advanceTimersByTimeAsync(50_000);
      expect(refresh).toHaveBeenCalledTimes(4); // now, 2 s, 4 s, 6 s: the date alone did not stop it
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells the page the moment the manage sheet closes, before the store is asked again, and only once', async () => {
    const order: string[] = [];
    const refresh = vi.fn(async () => { order.push('refresh'); });
    const p = fakeProvider({ openManage: async (_id, onClosed) => { order.push('sheet'); onClosed?.(); return true; }, refresh });
    await createPaymentsKit({ providers: { ios: p } }).openManage(() => order.push('closed'));
    expect(order).toEqual(['sheet', 'closed', 'refresh']);
    // A provider from before 2.5.0 never calls it: the kit does, once the sheet is gone.
    const older: string[] = [];
    const old = fakeProvider({ openManage: async () => { older.push('sheet'); return true; }, refresh: async () => { older.push('refresh'); } });
    await createPaymentsKit({ providers: { ios: old } }).openManage(() => older.push('closed'));
    expect(older).toEqual(['sheet', 'closed', 'refresh']);
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
      expect(refresh).toHaveBeenCalledTimes(12); // 2 now, then 10 later (not 20)
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

describe('watch waits for the store', () => {
  it('never reports free for a paying account before the store has answered', async () => {
    Platform.OS = 'ios';
    let release!: () => void;
    const slow = new Promise<void>((r) => { release = r; });
    const kit = createPaymentsKit({ providers: { ios: fakeProvider({ start: vi.fn(async () => { await slow; }), currentTier: async () => 'premium' }) } });
    const seen: string[] = [];
    const stop = kit.watch('user-1', (s) => seen.push(s.tier));
    await flush();
    expect(seen).toEqual([]);
    release();
    await flush();
    expect(seen).toEqual(['premium']);
    stop();
  });

  it('reports what it has once the store is slow for too long', async () => {
    vi.useFakeTimers();
    try {
      Platform.OS = 'ios';
      const kit = createPaymentsKit({ providers: { ios: fakeProvider({ start: () => new Promise<void>(() => undefined) }) } });
      const seen: string[] = [];
      kit.watch('user-1', (s) => seen.push(s.tier));
      await vi.advanceTimersByTimeAsync(5000);
      expect(seen).toEqual(['free']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('watch keeps a paying account paid when the store cannot be reached', () => {
  const memory = () => {
    const saved: Record<string, string> = {};
    return { saved, getItem: async (k: string) => saved[k] ?? null, setItem: async (k: string, v: string) => void (saved[k] = v) };
  };
  const ahead = new Date(Date.now() + 20 * 86_400_000).toISOString();

  it('reports the last known tier when start fails for the account (offline sign-in), then the store once it answers', async () => {
    vi.useFakeTimers();
    try {
      const storage = memory();
      const renewal = { until: ahead, willRenew: true, productId: 'monthly' };
      // Last launch: the store said Premium.
      const first = createPaymentsKit({ providers: { ios: fakeProvider({ currentTier: async () => 'premium', renewal: () => renewal }) }, storage });
      const stopFirst = first.watch('uid-1', () => undefined);
      await vi.advanceTimersByTimeAsync(0);
      stopFirst();
      // This launch: offline, the store can't move to the account.
      let offline = true;
      const start = vi.fn(async (id: string | null) => { if (id && offline) throw new Error('NETWORK_ERROR'); });
      const kit = createPaymentsKit({ providers: { ios: fakeProvider({ start, currentTier: async () => 'premium', renewal: () => renewal }) }, storage });
      const seen: TierState[] = [];
      const stop = kit.watch('uid-1', (s) => seen.push(s));
      await vi.advanceTimersByTimeAsync(0);
      expect(seen.at(-1)).toMatchObject({ tier: 'premium', source: 'store', renewal, remembered: true });
      expect(seen.some((s) => s.tier === 'free')).toBe(false);
      // It tries again by itself, with no trip to the background.
      offline = false;
      await vi.advanceTimersByTimeAsync(2000);
      expect(start).toHaveBeenCalledTimes(2);
      expect(seen.at(-1)).toMatchObject({ tier: 'premium', source: 'store' });
      expect(seen.at(-1)?.remembered).toBeUndefined();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the last known tier when the store start hangs past the wait', async () => {
    vi.useFakeTimers();
    try {
      const storage = memory();
      storage.saved['payments-kit:last-tier:uid-1'] = JSON.stringify({ tier: 'premium', renewal: { until: ahead, willRenew: true, productId: 'monthly' } });
      const kit = createPaymentsKit({ providers: { ios: fakeProvider({ start: () => new Promise<void>(() => undefined) }) }, storage });
      const seen: TierState[] = [];
      const stop = kit.watch('uid-1', (s) => seen.push(s));
      await vi.advanceTimersByTimeAsync(5000);
      expect(seen.map((s) => s.tier)).toEqual(['premium']);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the remembered tier go once its end date has passed, and never lends it to another account', async () => {
    const storage = memory();
    storage.saved['payments-kit:last-tier:uid-1'] = JSON.stringify({ tier: 'premium', renewal: { until: new Date(Date.now() - 1000).toISOString(), willRenew: true, productId: 'm' } });
    storage.saved['payments-kit:last-tier:uid-2'] = JSON.stringify({ tier: 'premium', renewal: { until: ahead, willRenew: true, productId: 'm' } });
    const start = async (id: string | null) => { if (id) throw new Error('offline'); };
    const kit = createPaymentsKit({ providers: { ios: fakeProvider({ start, currentTier: async () => 'premium' }) }, storage });
    const seen: TierState[] = [];
    const stop = kit.watch('uid-1', (s) => seen.push(s));
    await flush(); await flush();
    expect(seen.at(-1)?.tier).toBe('free');
    stop();
    const other: TierState[] = [];
    const stop3 = kit.watch('uid-3', (s) => other.push(s));
    await flush(); await flush();
    expect(other.at(-1)?.tier).toBe('free');
    stop3();
  });

  it('forgets Premium once the store itself says free', async () => {
    const storage = memory();
    let tier = 'premium';
    const kit = createPaymentsKit({ providers: { ios: fakeProvider({ currentTier: async () => tier, renewal: () => ({ until: ahead, willRenew: true, productId: 'm' }) }) }, storage });
    let stop = kit.watch('uid-1', () => undefined);
    await flush(); await flush();
    stop();
    expect(JSON.parse(storage.saved['payments-kit:last-tier:uid-1']!).tier).toBe('premium');
    tier = 'free';
    stop = kit.watch('uid-1', () => undefined);
    await flush(); await flush();
    stop();
    expect(JSON.parse(storage.saved['payments-kit:last-tier:uid-1']!).tier).toBe('free');
  });

  it('tries the store again at once when the device is back online, and backs off between tries', async () => {
    vi.useFakeTimers();
    try {
      let online: () => void = () => undefined;
      const onOnline = vi.fn((cb: () => void) => { online = cb; return () => { online = () => undefined; }; });
      let offline = true;
      const start = vi.fn(async (id: string | null) => { if (id && offline) throw new Error('offline'); });
      const kit = createPaymentsKit({ providers: { ios: fakeProvider({ start, currentTier: async () => 'premium' }) }, onOnline });
      const seen: TierState[] = [];
      const stop = kit.watch('uid-1', (s) => seen.push(s));
      await vi.advanceTimersByTimeAsync(0);
      expect(seen.at(-1)?.tier).toBe('free'); // nothing remembered on this phone yet
      await vi.advanceTimersByTimeAsync(2000); // 1st retry
      await vi.advanceTimersByTimeAsync(3999); // 2nd retry is 4 s after the 1st
      expect(start).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(start).toHaveBeenCalledTimes(3);
      offline = false;
      online();
      await vi.advanceTimersByTimeAsync(0);
      expect(start).toHaveBeenCalledTimes(4);
      expect(seen.at(-1)).toMatchObject({ tier: 'premium', source: 'store' });
      await vi.advanceTimersByTimeAsync(600_000);
      expect(start).toHaveBeenCalledTimes(4); // no more retries once it answered
      stop();
      expect(online).not.toBe(undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts nothing and reports nothing while the app still restores the session (undefined)', async () => {
    const p = fakeProvider({ currentTier: async () => 'premium' });
    const kit = createPaymentsKit({ providers: { ios: p } });
    const seen: TierState[] = [];
    kit.watch(undefined, (s) => seen.push(s))();
    await flush();
    expect(p.start).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});
