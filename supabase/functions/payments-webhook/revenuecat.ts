// RevenueCat webhook events → the common Change shape. Pure, so tests can check it.
import type { Change, Status } from './core.ts';

export type RcEvent = {
  id?: string;
  type: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  store?: string;
  environment?: string;
  period_type?: string;
  cancel_reason?: string;
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number | null;
  transferred_from?: string[];
  transferred_to?: string[];
};

const FOREVER_MS = 100 * 365 * 86_400_000;

/**
 * Turns one RevenueCat event into a Change, or null when it changes nothing.
 * `tiers` lowest first, starting with 'free'; entitlement ids in RevenueCat are the tier names.
 */
export function fromRevenueCat(e: RcEvent, tiers: string[], now: Date): Change | null {
  if (!e?.type || e.type === 'TEST') return null;
  const base = {
    eventId: e.id ?? `${e.type}:${e.app_user_id ?? ''}:${e.event_timestamp_ms ?? now.getTime()}`,
    provider: 'revenuecat',
    type: e.type,
    userIds: [e.app_user_id, e.original_app_user_id, ...(e.aliases ?? [])].filter((x): x is string => !!x),
    productId: e.product_id ?? null,
    store: e.store ?? null,
    environment: e.environment ?? null,
    eventAtMs: e.event_timestamp_ms ?? null,
  };
  if (e.type === 'TRANSFER') {
    return { ...base, tier: 'free', activeUntil: undefined, status: undefined, willRenew: undefined, transfer: { from: e.transferred_from ?? [], to: e.transferred_to ?? [] } };
  }
  // Only entitlements that are paid tiers count. A product not attached to one never unlocks anything.
  const paid = (e.entitlement_ids ?? []).filter((id) => id !== 'free' && tiers.includes(id));
  if (!paid.length) return null;
  const tier = paid.sort((a, b) => tiers.indexOf(b) - tiers.indexOf(a))[0]!;
  const end = e.expiration_at_ms ? new Date(e.expiration_at_ms).toISOString() : null;
  const nowIso = now.toISOString();
  const forever = new Date(now.getTime() + FOREVER_MS).toISOString();
  const paying: Status = e.period_type === 'TRIAL' ? 'trial' : 'active';
  const out = (activeUntil: string | null | undefined, status: Status | undefined, willRenew: boolean | undefined): Change => ({ ...base, tier, activeUntil, status, willRenew });

  switch (e.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'UNCANCELLATION':
    case 'SUBSCRIPTION_EXTENDED':
    case 'TEMPORARY_ENTITLEMENT_GRANT':
      return out(end ?? forever, paying, true);
    case 'NON_RENEWING_PURCHASE':
      return out(end ?? forever, 'active', false);
    case 'CANCELLATION':
      // A refund through store support ends access now; any other cancel only stops renewal.
      if (e.cancel_reason === 'CUSTOMER_SUPPORT') return out(end && Date.parse(end) < now.getTime() ? end : nowIso, 'refunded', false);
      return out(end ?? undefined, 'cancelled', false);
    case 'BILLING_ISSUE':
      // The store keeps a grace period; expiration_at_ms already includes it.
      return out(end ?? undefined, 'grace', undefined);
    case 'EXPIRATION':
      return out(end && Date.parse(end) < now.getTime() ? end : nowIso, 'expired', false);
    default:
      return null;
  }
}
