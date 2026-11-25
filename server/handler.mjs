// The webhook, for any backend: checks the secret, turns the provider's event into a Change, skips repeats and late
// events, and writes the rows through a SubscriptionStore. The store is the only part that knows the database.
import { isAccountId, isUuid, plan, sameSecret } from './core.mjs';
import { fromRevenueCat } from './revenuecat.mjs';

/** @typedef {import('./core.mjs').Change} Change */
/** @typedef {import('./core.mjs').Row} Row */
/** @typedef {import('./core.mjs').StoredRow} StoredRow */

/**
 * Where the webhook keeps each account's subscription row and its log of events. Implement these few functions to use any
 * database; `supabaseStore` and `firestoreStore` are ready-made ones.
 * @typedef {object} SubscriptionStore
 * @property {(eventId: string) => Promise<boolean>} hasEvent True when this event was already applied (a repeat delivery).
 * @property {(userIds: string[]) => Promise<StoredRow[]>} readRows The stored rows of these accounts; an account with none is left out.
 * @property {(row: Row) => Promise<'written' | 'no-account'>} writeRow Writes one row. 'no-account' when the database has no such account (that row is skipped). Throws on any other failure, so the provider retries.
 * @property {(event: LoggedEvent) => Promise<void>} logEvent Records the event once its rows are written, so a repeat is skipped.
 * @property {(id: string) => boolean} [isAccountId] Which user ids are real accounts. Default: any id that is not a store's anonymous id.
 */

/**
 * @typedef {object} LoggedEvent
 * @property {string} id
 * @property {string | null} userId
 * @property {string} provider
 * @property {string} type
 * @property {unknown} payload The provider's request body, as received.
 */

/** @typedef {(body: unknown, tiers: readonly string[], now: Date) => Change | null} ProviderAdapter */

/** One entry per provider: turns its request body into a Change (or null for "nothing to do"). */
/** @type {Record<string, ProviderAdapter>} */
export const PROVIDERS = {
  revenuecat: (body, tiers, now) => fromRevenueCat(/** @type {{ event: import('./revenuecat.mjs').RcEvent }} */ (body)?.event, tiers, now),
};

/**
 * @typedef {object} WebhookOptions
 * @property {string} secret The shared secret; the provider sends it as "Authorization: Bearer <secret>". Empty refuses every request.
 * @property {SubscriptionStore} store
 * @property {readonly string[]} [tiers] Lowest first, starting with 'free'. Default ['free', 'premium'].
 * @property {Record<string, ProviderAdapter>} [providers] Default `PROVIDERS`.
 * @property {string} [defaultProvider] Used when the address names no provider. Default 'revenuecat'.
 * @property {(message: string, detail?: unknown) => void} [log] Default console.error.
 */

/**
 * @typedef {object} WebhookRequest
 * @property {string} method
 * @property {string} provider The provider named in the address ('revenuecat'), or '' when none is named.
 * @property {string} authorization The Authorization header, or ''.
 * @property {() => Promise<unknown>} readBody Reads the JSON body; throws when it is not JSON.
 */

/** @typedef {{ status: number, body: Record<string, unknown> }} WebhookResult */

/** Tiers from a comma-separated setting such as "free,premium". */
export const parseTiers = (/** @type {string | undefined} */ text) => (text || 'free,premium').split(',').map((t) => t.trim()).filter(Boolean);

/**
 * Handles one webhook request with any runtime and any store. The runtime adapters (`paymentsWebhook` for Request and
 * Response, the Firebase function) only translate the request and the answer.
 * @param {WebhookRequest} req
 * @param {WebhookOptions} options
 * @param {Date} [now]
 * @returns {Promise<WebhookResult>}
 */
export async function handlePaymentEvent(req, options, now = new Date()) {
  const log = options.log ?? ((message, detail) => console.error(message, detail));
  if (req.method !== 'POST') return { status: 405, body: { error: 'POST only' } };
  if (!options.secret || !sameSecret(`Bearer ${options.secret}`, req.authorization)) return { status: 401, body: { error: 'unauthorized' } };

  const providers = options.providers ?? PROVIDERS;
  const name = req.provider || (options.defaultProvider ?? 'revenuecat');
  // Only a provider this webhook knows: anything else is turned away instead of being read as RevenueCat.
  const toChange = Object.prototype.hasOwnProperty.call(providers, name) ? providers[name] : null;
  if (!toChange) return { status: 404, body: { error: 'unknown provider' } };

  /** @type {unknown} */
  let body;
  try {
    body = await req.readBody();
  } catch {
    return { status: 400, body: { error: 'bad json' } };
  }
  const change = toChange(body, options.tiers ?? ['free', 'premium'], now);
  if (!change) return { status: 200, body: { ok: true, skipped: 'nothing to change' } };

  const { store } = options;
  try {
    // A repeated delivery of an event already applied is skipped.
    if (await store.hasEvent(change.eventId)) return { status: 200, body: { ok: true, skipped: 'duplicate' } };

    const ids = change.transfer ? [...change.transfer.from, ...change.transfer.to] : change.userIds;
    const rows = plan(change, await store.readRows(ids), now, store.isAccountId ?? isAccountId);

    // One row at a time, so an id with no account is skipped instead of failing the rest.
    let updated = 0;
    for (const row of rows) if ((await store.writeRow(row)) === 'written') updated++;

    // Logged after the rows are written, so a failed write is retried rather than skipped as a duplicate.
    try {
      await store.logEvent({ id: change.eventId, userId: rows[0]?.user_id ?? null, provider: change.provider, type: change.type, payload: body });
    } catch (e) {
      log('payments-webhook: could not log event', e instanceof Error ? e.message : e);
    }
    return { status: 200, body: { ok: true, updated } };
  } catch (e) {
    // The provider retries a failed delivery later.
    const message = e instanceof Error ? e.message : String(e);
    log('payments-webhook: could not save the change', message);
    return { status: 500, body: { error: message } };
  }
}

/**
 * The provider named by the last part of an address, or '' when the address names none (it ends with the function's own name).
 * @param {string} pathname e.g., "/functions/v1/payments-webhook/revenuecat"
 * @param {string} [functionName] Default 'payments-webhook'.
 */
export function providerFromPath(pathname, functionName = 'payments-webhook') {
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  return last === functionName ? '' : last;
}

/**
 * The webhook as a standard `(Request) => Promise<Response>` handler, for Supabase Edge Functions, Deno, Cloudflare Workers,
 * Bun and Node 18+.
 * @param {WebhookOptions & { functionName?: string }} options
 * @returns {(req: Request) => Promise<Response>}
 */
export function paymentsWebhook(options) {
  return async (req) => {
    const result = await handlePaymentEvent(
      { method: req.method, provider: providerFromPath(new URL(req.url).pathname, options.functionName), authorization: req.headers.get('authorization') ?? '', readBody: () => req.json() },
      options,
    );
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
  };
}

export { isAccountId, isUuid };
