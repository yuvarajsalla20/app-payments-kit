import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaymentsKit, type PaymentProvider, type ServerSubscription, type TierState } from '../src';
import { Platform, appState } from './stubs/react-native';

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
});
