/** A length of time as the stores describe it (a 7-day trial is DAY × 7 or WEEK × 1). */
export type PeriodUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
export interface Period {
  unit: PeriodUnit;
  count: number;
}

/** One thing on sale, with the store's own price in the buyer's currency. */
export interface Plan {
  /** The app's own name for it, such as 'yearly' or 'pro_monthly'. */
  id: string;
  /** The tier it unlocks, such as 'premium' or 'pro'. */
  tier: string;
  /** Ready to show: "$39.99", "39,99 €". */
  priceString: string;
  price: number;
  /** ISO 4217 code, such as USD. */
  currency: string;
  /** How often it charges; null for a one-off purchase. */
  period: Period | null;
  /** Days of free trial this person can still get on this plan; null when there is none or it is used up. */
  trialDays: number | null;
  /** The provider's own object, passed back to buy(). Apps should not read it. */
  native?: unknown;
}

export type BuyResult =
  | { ok: true; tier: string }
  | { ok: false; cancelled: boolean; pending?: boolean; message: string };

/** What a payment vendor must do. One adapter per vendor (RevenueCat, Stripe, ...). */
export interface PaymentProvider {
  /** Shown in logs and saved with purchases, such as 'revenuecat'. */
  name: string;
  /** False when this provider can't sell here (no key, web without checkout, Expo Go without a native module). */
  ready: boolean;
  /** Ties purchases to the signed-in account; null on sign-out. */
  start(userId: string | null): Promise<void>;
  loadPlans(): Promise<Plan[]>;
  buy(plan: Plan, userId: string | null): Promise<BuyResult>;
  restore(userId: string | null): Promise<BuyResult>;
  /** The highest tier the store says this person has now ('free' when none). */
  currentTier(): Promise<string>;
  onTierChange(cb: (tier: string) => void): () => void;
  /** Opens the store's code sheet, or a redeem page for this code. */
  redeemCode?(code: string): Promise<void>;
  /** The store's own "manage subscription" page, or null when there is none. */
  manageUrl?(): string | null;
}

/** Where the server-side subscription row is read from (Supabase now, Firebase later). */
export interface SubscriptionBackend {
  read(userId: string): Promise<ServerSubscription | null>;
}

export type SubscriptionStatus = 'active' | 'trial' | 'grace' | 'cancelled' | 'expired' | 'refunded' | 'pending';

/** One account's row on the server, kept up to date by the webhook only. */
export interface ServerSubscription {
  tier: string;
  activeUntil: string | null;
  status: SubscriptionStatus | null;
  willRenew: boolean | null;
  provider: string | null;
  productId: string | null;
}
