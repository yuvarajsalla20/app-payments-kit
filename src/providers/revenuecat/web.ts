import { ErrorCode, Purchases, type CustomerInfo, type Package } from '@revenuecat/purchases-js';
import { DEFAULT_MESSAGES, periodDays, type PaymentMessages } from '../../core/messages';
import { FREE, normalizeTiers } from '../../core/tiers';
import type { BuyResult, PaymentProvider, Plan } from '../../core/types';
import { findPackage, parsePeriod, tierOf, type RevenueCatPlan } from './shared';

export interface RevenueCatWebOptions {
  /**
   * The Web Billing public API key from RevenueCat → Project → API keys (starts with rcb_, or rcb_sb_ for sandbox).
   * Safe to ship in the website. Without it the provider is not ready and the Plans screen says purchases are not open.
   */
  apiKey?: string;
  /** Same list as the phone provider: RevenueCat package type or identifier for each plan, in the order shown. */
  plans: RevenueCatPlan[];
  /** Tiers lowest first, starting with 'free'. Must match the payments kit's tiers. */
  tiers?: readonly string[];
  /** Entitlement id in RevenueCat for each paid tier. Default: the tier's own name. */
  entitlements?: Record<string, string>;
  /** A RevenueCat offering id; default is the current offering. */
  offering?: string;
  /** The signed-in person's email, so checkout does not ask for it again. Optional. */
  customerEmail?: () => string | null | undefined | Promise<string | null | undefined>;
  messages?: Partial<PaymentMessages>;
}

/** Turns a Web Billing error into a result the app can show. */
export function webFailure(e: unknown, m: PaymentMessages = DEFAULT_MESSAGES): BuyResult {
  const code = (e as { errorCode?: number } | null)?.errorCode;
  if (code === ErrorCode.UserCancelledError) return { ok: false, cancelled: true, message: '' };
  if (code === ErrorCode.PaymentPendingError) return { ok: false, cancelled: false, pending: true, message: m.pending };
  if (code === ErrorCode.PurchaseNotAllowedError) return { ok: false, cancelled: false, message: m.notAllowed };
  if (code === ErrorCode.NetworkError) return { ok: false, cancelled: false, message: m.network };
  if (code === ErrorCode.ProductAlreadyPurchasedError) return { ok: false, cancelled: false, message: m.alreadyOwned };
  return { ok: false, cancelled: false, message: m.generic };
}

/** One RevenueCat web package as a kit Plan. A trial shows only when RevenueCat offers it to this person. */
export function webPlan(p: RevenueCatPlan, pkg: Package): Plan {
  const product = pkg.webBillingProduct;
  const trial = parsePeriod(product.defaultSubscriptionOption?.trial?.periodDuration);
  return {
    id: p.id,
    tier: p.tier,
    priceString: product.currentPrice.formattedPrice,
    price: product.currentPrice.amountMicros / 1_000_000,
    currency: product.currentPrice.currency,
    period: parsePeriod(product.normalPeriodDuration),
    trialDays: trial ? periodDays(trial.unit, trial.count) : null,
    native: pkg,
  };
}

/**
 * RevenueCat Web Billing for the website. RevenueCat shows its own card checkout (Stripe or Paddle behind it) and
 * keeps one customer per account, so Premium bought on the web counts on the phone and the other way round.
 * The person must be signed in: web purchases are tied to the account, there is no anonymous buyer.
 */
export function revenueCatWeb(options: RevenueCatWebOptions): PaymentProvider {
  const tiers = normalizeTiers(options.tiers);
  const m: PaymentMessages = { ...DEFAULT_MESSAGES, ...options.messages };
  const key = options.apiKey ?? '';
  const ready = key.length > 0;
  const tierFor = (info: CustomerInfo | null | undefined) => tierOf(info, tiers, options.entitlements);

  let rc: Purchases | null = null;
  let current: string | null = null;
  let manageUrl: string | null = null;
  // The web SDK has no "customer changed" listener, so the provider tells listeners after each buy, restore and check.
  const listeners = new Set<(tier: string) => void>();
  const seen = (info: CustomerInfo): string => {
    manageUrl = info.managementURL ?? null;
    const tier = tierFor(info);
    listeners.forEach((l) => l(tier));
    return tier;
  };
  const signedIn = () => (rc && current ? rc : null);
  const notSignedIn: BuyResult = { ok: false, cancelled: false, message: m.notSignedIn };

  return {
    name: 'revenuecat-web',
    ready,
    async start(userId) {
      if (!ready) return;
      if (!userId) {
        // The web SDK has no sign-out; forgetting the account here is enough, since nothing is bought without one.
        current = null;
        manageUrl = null;
        return;
      }
      if (!rc) {
        rc = Purchases.isConfigured() ? Purchases.getSharedInstance() : Purchases.configure({ apiKey: key, appUserId: userId });
      }
      if (rc.getAppUserId() !== userId) await rc.changeUser(userId);
      current = userId;
    },
    async loadPlans() {
      const p = signedIn();
      if (!p) return [];
      const all = await p.getOfferings();
      const offering = options.offering ? all.all[options.offering] : all.current;
      if (!offering) return [];
      return options.plans.flatMap((plan) => {
        const pkg = findPackage(offering.availablePackages, plan);
        return pkg ? [webPlan(plan, pkg)] : [];
      });
    },
    async buy(plan, userId) {
      if (!ready) return { ok: false, cancelled: false, message: m.notReady };
      const p = signedIn();
      if (!p || !userId || userId !== current) return notSignedIn;
      if (!plan.native) return { ok: false, cancelled: false, message: m.storeUnreachable };
      try {
        const customerEmail = (await options.customerEmail?.()) ?? undefined;
        const { customerInfo } = await p.purchase({ rcPackage: plan.native as Package, customerEmail });
        return { ok: true, tier: seen(customerInfo) };
      } catch (e) {
        return webFailure(e, m);
      }
    },
    async restore(userId) {
      // Web purchases belong to the account, so "restore" is a fresh look at it.
      if (!ready) return { ok: false, cancelled: false, message: m.notReady };
      const p = signedIn();
      if (!p || !userId || userId !== current) return notSignedIn;
      try {
        return { ok: true, tier: seen(await p.getCustomerInfo()) };
      } catch (e) {
        return webFailure(e, m);
      }
    },
    async currentTier() {
      const p = signedIn();
      return p ? seen(await p.getCustomerInfo()) : FREE;
    },
    onTierChange(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    // No redeemCode: App Store and Google Play codes can't be used on the web.
    manageUrl() {
      return manageUrl;
    },
  };
}
