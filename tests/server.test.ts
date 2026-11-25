import { describe, expect, it, vi } from 'vitest';
import { firestoreStore, handlePaymentEvent, isAccountId, paymentsWebhook, parseTiers, providerFromPath, supabaseStore, type SubscriptionStore } from '../server/index.mjs';

const now = new Date('2026-11-07T12:00:00Z');
const later = Date.parse('2026-12-07T12:00:00Z');
const UID = 'Xk3pQ9rT2bWfLm7Ns4Vc8Hd1Za62'; // a Firebase user id
const U1 = '11111111-1111-4111-8111-111111111111';
const event = (over: Record<string, unknown> = {}) => ({ event: { id: 'e1', type: 'INITIAL_PURCHASE', app_user_id: UID, entitlement_ids: ['premium'], expiration_at_ms: later, event_timestamp_ms: now.getTime(), store: 'APP_STORE', environment: 'SANDBOX', ...over } });

/** A store kept in memory, to check the handler against the interface alone. */
function memoryStore(): SubscriptionStore & { rows: Map<string, any>; events: Map<string, any> } {
  const rows = new Map<string, any>();
  const events = new Map<string, any>();
  return {
    rows,
    events,
    hasEvent: async (id) => events.has(id),
    readRows: async (ids) => ids.filter((id) => rows.has(id)).map((id) => rows.get(id)),
    writeRow: async (row) => (rows.set(row.user_id, row), 'written'),
    logEvent: async (e) => void events.set(e.id, e),
  };
}

const call = (store: SubscriptionStore, body: unknown, over: Partial<{ method: string; provider: string; authorization: string }> = {}) =>
  handlePaymentEvent({ method: 'POST', provider: '', authorization: 'Bearer s3cret', readBody: async () => body, ...over }, { secret: 's3cret', store, log: () => {} }, now);

describe('the webhook with any store', () => {
  it('writes the row through the store and logs the event', async () => {
    const store = memoryStore();
    expect(await call(store, event())).toEqual({ status: 200, body: { ok: true, updated: 1 } });
    expect(store.rows.get(UID)).toMatchObject({ tier: 'premium', status: 'active', will_renew: true, active_until: new Date(later).toISOString(), store: 'APP_STORE' });
    expect(store.events.get('e1')).toMatchObject({ userId: UID, provider: 'revenuecat', type: 'INITIAL_PURCHASE' });
  });
  it('skips a repeated delivery', async () => {
    const store = memoryStore();
    await call(store, event());
    expect((await call(store, event())).body).toEqual({ ok: true, skipped: 'duplicate' });
  });
  it('refuses a wrong secret, another method and an unknown provider', async () => {
    const store = memoryStore();
    expect((await call(store, event(), { authorization: 'Bearer nope' })).status).toBe(401);
    expect((await call(store, event(), { method: 'GET' })).status).toBe(405);
    expect((await call(store, event(), { provider: 'paddle' })).status).toBe(404);
    expect((await handlePaymentEvent({ method: 'POST', provider: '', authorization: 'Bearer ', readBody: async () => event() }, { secret: '', store }, now)).status).toBe(401);
    expect(store.rows.size).toBe(0);
  });
  it('answers 400 for a body that is not JSON', async () => {
    const res = await handlePaymentEvent({ method: 'POST', provider: 'revenuecat', authorization: 'Bearer s3cret', readBody: async () => JSON.parse('{') }, { secret: 's3cret', store: memoryStore() }, now);
    expect(res.status).toBe(400);
  });
  it('answers 500 when the store fails, without logging the event, so the provider retries', async () => {
    const store = memoryStore();
    store.writeRow = async () => {
      throw new Error('offline');
    };
    expect(await call(store, event())).toEqual({ status: 500, body: { error: 'offline' } });
    expect(store.events.size).toBe(0);
  });
  it('leaves out anonymous store ids, and follows the store rule for account ids', async () => {
    const store = memoryStore();
    expect((await call(store, event({ app_user_id: '$RCAnonymousID:abc' }))).body).toEqual({ ok: true, updated: 0 });
    const uuidOnly = { ...memoryStore(), isAccountId: (id: string) => id === U1 };
    expect((await call(uuidOnly, event({ id: 'e2' }))).body).toEqual({ ok: true, updated: 0 });
    expect(isAccountId(UID)).toBe(true);
    expect(isAccountId('a/b')).toBe(false);
  });
  it('a row the store reports as having no account is skipped', async () => {
    const store = memoryStore();
    store.writeRow = async () => 'no-account';
    expect((await call(store, event())).body).toEqual({ ok: true, updated: 0 });
  });
});

describe('addresses and settings', () => {
  it('reads the provider from the address', () => {
    expect(providerFromPath('/functions/v1/payments-webhook/revenuecat')).toBe('revenuecat');
    expect(providerFromPath('/functions/v1/payments-webhook')).toBe('');
    expect(providerFromPath('/')).toBe('');
  });
  it('reads tiers from a setting', () => {
    expect(parseTiers('free, plus ,pro')).toEqual(['free', 'plus', 'pro']);
    expect(parseTiers('')).toEqual(['free', 'premium']);
  });
  it('works as a Request and Response handler', async () => {
    const store = memoryStore();
    const handler = paymentsWebhook({ secret: 's3cret', store, log: () => {} });
    const res = await handler(new Request('https://x.supabase.co/functions/v1/payments-webhook/revenuecat', { method: 'POST', headers: { authorization: 'Bearer s3cret' }, body: JSON.stringify(event()) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updated: 1 });
  });
});

describe('Firestore store', () => {
  /** The few Admin SDK calls the store uses. */
  function fakeDb() {
    const data = new Map<string, any>();
    const collection = (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({ id, exists: data.has(`${name}/${id}`), data: () => data.get(`${name}/${id}`) }),
        set: async (value: unknown) => void data.set(`${name}/${id}`, value),
      }),
    });
    return { data, collection };
  }
  it('writes one document per account and one per event', async () => {
    const db = fakeDb();
    expect((await call(firestoreStore(db), event())).body).toEqual({ ok: true, updated: 1 });
    expect(db.data.get(`subscriptions/${UID}`)).toEqual({ tier: 'premium', activeUntil: new Date(later).toISOString(), status: 'active', willRenew: true, provider: 'revenuecat', store: 'APP_STORE', productId: null, environment: 'SANDBOX', eventAt: now.toISOString(), updatedAt: now.toISOString() });
    expect(db.data.get('subscriptionEvents/e1')).toMatchObject({ userId: UID, type: 'INITIAL_PURCHASE' });
    expect((await call(firestoreStore(db), event())).body).toEqual({ ok: true, skipped: 'duplicate' });
  });
  it('keeps a newer change when a late event arrives', async () => {
    const db = fakeDb();
    const store = firestoreStore(db, { collection: 'subs', events: 'subEvents' });
    await call(store, event({ id: 'new', type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', event_timestamp_ms: now.getTime() }));
    await call(store, event({ id: 'old', type: 'RENEWAL', event_timestamp_ms: now.getTime() - 60_000 }));
    expect(db.data.get(`subs/${UID}`)).toMatchObject({ status: 'cancelled', willRenew: false });
  });
});

describe('Supabase store', () => {
  function fakeClient(writeError: { code: string; message: string } | null = null) {
    const upserts: unknown[] = [];
    const inserts: unknown[] = [];
    const query = (result: unknown) => ({ eq: () => ({ maybeSingle: async () => ({ data: result, error: null }) }), in: async () => ({ data: [], error: null }) });
    return {
      upserts,
      inserts,
      from: (table: string) => ({
        select: () => query(null),
        upsert: async (row: unknown) => (upserts.push({ table, row }), { error: writeError }),
        insert: async (row: unknown) => (inserts.push({ table, row }), { error: null }),
      }),
    };
  }
  it('writes the row and logs the event, as before', async () => {
    const client = fakeClient();
    expect((await call(supabaseStore(client), event({ app_user_id: U1 }))).body).toEqual({ ok: true, updated: 1 });
    expect(client.upserts).toMatchObject([{ table: 'subscriptions', row: { user_id: U1, tier: 'premium' } }]);
    expect(client.inserts).toMatchObject([{ table: 'subscription_events', row: { id: 'e1', user_id: U1 } }]);
  });
  it('only UUIDs are accounts; an id with no account is skipped', async () => {
    expect((await call(supabaseStore(fakeClient()), event())).body).toEqual({ ok: true, updated: 0 });
    expect((await call(supabaseStore(fakeClient({ code: '23503', message: 'fk' })), event({ app_user_id: U1 }))).body).toEqual({ ok: true, updated: 0 });
    expect((await call(supabaseStore(fakeClient({ code: '500', message: 'down' })), event({ app_user_id: U1 }))).status).toBe(500);
  });
});

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  getDoc: async (ref: { path: string }) => {
    const d = ref.path === 'subscriptions/u1' ? { tier: 'premium', activeUntil: '2026-12-07T12:00:00.000Z', status: 'active', willRenew: true, provider: 'revenuecat', productId: 'plus_yearly' } : null;
    return { exists: () => !!d, data: () => d };
  },
}));

describe('firestoreBackend (app side)', () => {
  it('reads the account document in the shape the kit uses', async () => {
    const { firestoreBackend } = await import('../firestore');
    const backend = firestoreBackend({} as never);
    expect(await backend.read('u1')).toEqual({ tier: 'premium', activeUntil: '2026-12-07T12:00:00.000Z', status: 'active', willRenew: true, provider: 'revenuecat', productId: 'plus_yearly' });
    expect(await backend.read('u2')).toBeNull();
    expect(await firestoreBackend(null).read('u1')).toBeNull();
  });
});
