// What a payment event means for an account's subscription row. Plain JavaScript with no database and no runtime
// (Node, Deno and Workers all run it), so every backend shares it and tests can check it.

/** @typedef {'active' | 'trial' | 'grace' | 'cancelled' | 'expired' | 'refunded' | 'pending'} Status */

/**
 * A provider event in one common shape. Each provider adapter makes these.
 * @typedef {object} Change
 * @property {string} eventId The provider's event id; a repeat is skipped.
 * @property {string} provider
 * @property {string} type
 * @property {string[]} userIds Every account id the purchase is known by.
 * @property {string} tier
 * @property {string | null | undefined} activeUntil New end of access (ISO). null = no access now. undefined = this event doesn't change it.
 * @property {Status | undefined} status
 * @property {boolean | undefined} willRenew
 * @property {string | null} productId
 * @property {string | null} store
 * @property {string | null} environment
 * @property {number | null} eventAtMs When the event happened, in ms. Older than the stored one = ignored.
 * @property {{ from: string[], to: string[] }} [transfer] A purchase moved between accounts (a restore on another account).
 */

/**
 * The part of a stored row the planner needs.
 * @typedef {object} StoredRow
 * @property {string} user_id
 * @property {string} tier
 * @property {string | null} active_until
 * @property {boolean | null} will_renew
 * @property {string | null} event_at
 */

/**
 * One account's row, as every store receives it to write.
 * @typedef {object} Row
 * @property {string} user_id
 * @property {string} tier
 * @property {string | null} active_until
 * @property {Status | null} status
 * @property {boolean | null} will_renew
 * @property {string} provider
 * @property {string | null} store
 * @property {string | null} product_id
 * @property {string | null} environment
 * @property {string | null} event_at
 * @property {string} updated_at
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Supabase account id (a UUID). */
export const isUuid = (/** @type {string} */ id) => UUID.test(id);

/**
 * Any real account id: not a store's anonymous id (such as $RCAnonymousID:…), at most 128 characters, and no slash, so it
 * is safe as a document id. Fits Firebase user ids and most other backends.
 */
export const isAccountId = (/** @type {string} */ id) => !id.startsWith('$') && id.length <= 128 && !id.includes('/');

/**
 * Only real account ids, each once (anonymous store ids are left out).
 * @param {(string | null | undefined)[]} xs
 * @param {(id: string) => boolean} [isAccount] Default `isUuid`, the Supabase rule.
 * @returns {string[]}
 */
export const accountIds = (xs, isAccount = isUuid) => [...new Set(xs.filter((x) => !!x && isAccount(/** @type {string} */ (x))))].map(String);

/**
 * Applies an event only if it is newer than the last one applied to that account.
 * @param {number | null | undefined} eventMs
 * @param {string | null | undefined} storedIso
 */
export const isNewer = (eventMs, storedIso) => !storedIso || !eventMs || eventMs >= Date.parse(storedIso);

/**
 * Same length and same content, compared without stopping early, so timing can't reveal the secret.
 * @param {string} a
 * @param {string} b
 */
export function sameSecret(a, b) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The rows to write for this change, given what is stored for those accounts now.
 * Late or repeated events never undo a newer one.
 * @param {Change} change
 * @param {StoredRow[]} stored
 * @param {Date} now
 * @param {(id: string) => boolean} [isAccount] Which ids are real accounts. Default `isUuid`, the Supabase rule.
 * @returns {Row[]}
 */
export function plan(change, stored, now, isAccount = isUuid) {
  const nowIso = now.toISOString();
  const eventAt = change.eventAtMs ? new Date(change.eventAtMs).toISOString() : null;
  const base = { provider: change.provider, store: change.store, product_id: change.productId, environment: change.environment, event_at: eventAt, updated_at: nowIso };
  const find = (/** @type {string} */ id) => stored.find((s) => s.user_id === id);
  const fresh = (/** @type {string} */ id) => isNewer(change.eventAtMs, find(id)?.event_at);

  if (change.transfer) {
    const from = accountIds(change.transfer.from, isAccount);
    const to = accountIds(change.transfer.to, isAccount);
    // The new account gets the latest end date the old accounts had.
    const old = from
      .map(find)
      .filter((r) => !!r && !!r.active_until)
      .sort((a, b) => Date.parse(/** @type {string} */ (b?.active_until)) - Date.parse(/** @type {string} */ (a?.active_until)))[0];
    /** @type {Row[]} */
    const rows = from.filter(fresh).map((user_id) => ({ ...base, user_id, tier: find(user_id)?.tier ?? change.tier, active_until: nowIso, status: 'expired', will_renew: false }));
    if (old) rows.push(...to.filter(fresh).map((user_id) => ({ ...base, user_id, tier: old.tier, active_until: old.active_until, status: /** @type {Status} */ ('active'), will_renew: null })));
    return rows;
  }

  if (change.activeUntil === undefined && change.status === undefined) return [];
  return accountIds(change.userIds, isAccount)
    .filter(fresh)
    .map((user_id) => {
      const prev = find(user_id);
      return {
        ...base,
        user_id,
        tier: change.tier,
        active_until: change.activeUntil === undefined ? prev?.active_until ?? null : change.activeUntil,
        status: change.status ?? null,
        will_renew: change.willRenew ?? prev?.will_renew ?? null,
      };
    });
}
