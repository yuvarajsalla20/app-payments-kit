// What a payment event means for the subscriptions table. Pure (no database, no Deno), so tests can check it.

export type Status = 'active' | 'trial' | 'grace' | 'cancelled' | 'expired' | 'refunded' | 'pending';

/** A provider event in one common shape. Each provider adapter makes these. */
export interface Change {
  /** The provider's event id; a repeat is skipped. */
  eventId: string;
  provider: string;
  type: string;
  /** Every account id the purchase is known by. */
  userIds: string[];
  tier: string;
  /** New end of access (ISO). null = no access now. undefined = this event doesn't change it. */
  activeUntil: string | null | undefined;
  status: Status | undefined;
  willRenew: boolean | undefined;
  productId: string | null;
  store: string | null;
  environment: string | null;
  /** When the event happened, in ms. Older than the stored one = ignored. */
  eventAtMs: number | null;
  /** A purchase moved between accounts (a restore on another account). */
  transfer?: { from: string[]; to: string[] };
}

/** The part of a stored row the planner needs. */
export interface StoredRow {
  user_id: string;
  tier: string;
  active_until: string | null;
  will_renew: boolean | null;
  event_at: string | null;
}

export interface Row {
  user_id: string;
  tier: string;
  active_until: string | null;
  status: Status | null;
  will_renew: boolean | null;
  provider: string;
  store: string | null;
  product_id: string | null;
  environment: string | null;
  event_at: string | null;
  updated_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Only real account ids (anonymous store ids such as $RCAnonymousID are left out). */
export const accountIds = (xs: (string | null | undefined)[]): string[] => [...new Set(xs.filter((x): x is string => !!x && UUID.test(x)))];

/** Applies an event only if it is newer than the last one applied to that account. */
export const isNewer = (eventMs: number | null | undefined, storedIso: string | null | undefined): boolean =>
  !storedIso || !eventMs || eventMs >= Date.parse(storedIso);

/** Same length and same content, compared without stopping early, so timing can't reveal the secret. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The rows to write for this change, given what is stored for those accounts now.
 * Late or repeated events never undo a newer one.
 */
export function plan(change: Change, stored: StoredRow[], now: Date): Row[] {
  const nowIso = now.toISOString();
  const eventAt = change.eventAtMs ? new Date(change.eventAtMs).toISOString() : null;
  const base = { provider: change.provider, store: change.store, product_id: change.productId, environment: change.environment, event_at: eventAt, updated_at: nowIso };
  const find = (id: string) => stored.find((s) => s.user_id === id);
  const fresh = (id: string) => isNewer(change.eventAtMs, find(id)?.event_at);

  if (change.transfer) {
    const from = accountIds(change.transfer.from);
    const to = accountIds(change.transfer.to);
    // The new account gets the latest end date the old accounts had.
    const old = from.map(find).filter((r): r is StoredRow => !!r && !!r.active_until).sort((a, b) => Date.parse(b.active_until!) - Date.parse(a.active_until!))[0];
    const rows: Row[] = from.filter(fresh).map((user_id) => ({ ...base, user_id, tier: find(user_id)?.tier ?? change.tier, active_until: nowIso, status: 'expired', will_renew: false }));
    if (old) rows.push(...to.filter(fresh).map((user_id) => ({ ...base, user_id, tier: old.tier, active_until: old.active_until, status: 'active' as Status, will_renew: null })));
    return rows;
  }

  if (change.activeUntil === undefined && change.status === undefined) return [];
  return accountIds(change.userIds)
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
