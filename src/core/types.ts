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
  /** Shown in logs, such as 'revenuecat-mobile' or 'revenuecat-web'. */
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
  /** When the tier the store last reported ends or renews, and whether it renews. Null when free or unknown. */
  renewal?(): Renewal | null;
  /**
   * Shows the store's own manage screen inside the app. True when it was shown; false (or a throw) falls back to `manageUrl`.
   * `userId` is the signed-in person: anything sent to the store afterwards is booked to them only.
   */
  openManage?(userId?: string | null): Promise<boolean>;
  /** Drops any saved copy of the store's answer, so the next currentTier() and renewal() ask the store again. */
  refresh?(): Promise<void>;
  /** A store discount for people who already subscribe (an App Store promotional offer), or null when the store has none by that id. */
  loadOffer?(offerId: string): Promise<Offer | null>;
  buyOffer?(offer: Offer, userId: string | null): Promise<BuyResult>;
}

/** A discount for people who already subscribe, such as "$1.99/month for 3 months", with the store's own price. */
export interface Offer {
  /** The offer id set in the store, such as 'monthly_stay50'. */
  id: string;
  /** The plan it discounts. */
  plan: Plan;
  priceString: string;
  price: number;
  /** One discounted period, and how many of them. */
  period: Period;
  cycles: number;
  /** The provider's own object. Apps should not read it. */
  native?: unknown;
}

/** The store's view of the paid tier: the date it ends or renews (ISO, null for lifetime) and whether it renews. */
export interface Renewal {
  until: string | null;
  willRenew: boolean;
  /** The store product that gives the tier, such as 'hringnring_monthly'. Null when the store doesn't say. */
  productId: string | null;
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
