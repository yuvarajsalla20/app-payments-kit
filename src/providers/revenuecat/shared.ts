// Pieces the RevenueCat mobile and web providers share. Type-only imports, so the web build never pulls in
// react-native-purchases and the phone build never pulls in @revenuecat/purchases-js.
import { FREE, rank } from '../../core/tiers';
import type { Period, PeriodUnit, Renewal } from '../../core/types';

/** One plan the app sells, matched to a RevenueCat package in the offering. The same list works on phone and web. */
export interface RevenueCatPlan {
  /** The app's own name for it, such as 'yearly'. */
  id: string;
  /** The tier it unlocks, such as 'premium'. */
  tier: string;
  /** A package type ('ANNUAL', 'SIX_MONTH', 'THREE_MONTH', 'MONTHLY', 'WEEKLY', 'LIFETIME') or a custom package identifier. */
  package: string;
}

/** The part of RevenueCat's customer info the kit reads. Phone and web SDKs both have it. */
export interface EntitlementsLike {
  entitlements?: { active?: Record<string, unknown> } | null;
}

const UNIT: Record<string, PeriodUnit> = { D: 'DAY', W: 'WEEK', M: 'MONTH', Y: 'YEAR' };

/** "P1M", "P1Y", "P3M", "P1W", "P7D" → { unit, count }; null for a one-off purchase. */
export function parsePeriod(iso: string | null | undefined): Period | null {
  const m = /^P(\d+)([DWMY])$/.exec(iso ?? '');
  return m ? { unit: UNIT[m[2]!]!, count: Number(m[1]) } : null;
}

/** The highest tier whose entitlement is active. */
export function tierOf(info: EntitlementsLike | null | undefined, tiers: readonly string[], entitlements: Record<string, string> = {}): string {
  const active = info?.entitlements?.active ?? {};
  let best = FREE;
  for (const t of tiers) if (t !== FREE && active[entitlements[t] ?? t] && rank(tiers, t) > rank(tiers, best)) best = t;
  return best;
}

/** The part of an entitlement the renewal line reads. Phone SDK dates are ISO strings, web SDK dates are Date objects. */
interface EntitlementLike {
  expirationDate?: string | Date | null;
  willRenew?: boolean;
}

/** When this tier's entitlement ends or renews, and whether it renews. Null for 'free' or when the entitlement isn't active. */
export function renewalOf(info: EntitlementsLike | null | undefined, tier: string, entitlements: Record<string, string> = {}): Renewal | null {
  if (tier === FREE) return null;
  const e = info?.entitlements?.active?.[entitlements[tier] ?? tier] as EntitlementLike | undefined;
  if (!e) return null;
  const d = e.expirationDate;
  return { until: d ? new Date(d).toISOString() : null, willRenew: e.willRenew !== false };
}

/** The package in an offering for one plan: by package type first, then by identifier. */
export function findPackage<P extends { packageType: string; identifier: string }>(packages: readonly P[], plan: RevenueCatPlan): P | undefined {
  return packages.find((x) => x.packageType === plan.package || x.identifier === plan.package);
}
