import { Linking, Platform } from 'react-native';
import Purchases, { LOG_LEVEL, PURCHASES_ERROR_CODE, type CustomerInfo, type PurchasesPackage, type PurchasesStoreProductDiscount } from 'react-native-purchases';
import { DEFAULT_MESSAGES, periodDays, type PaymentMessages } from '../../core/messages';
import { FREE, normalizeTiers } from '../../core/tiers';
import type { BuyResult, Offer, PaymentProvider, PeriodUnit, Plan } from '../../core/types';
import { findPackage, parsePeriod, renewalOf, tierOf, type RevenueCatPlan } from './shared';

export { parsePeriod, tierOf, type RevenueCatPlan } from './shared';

export interface RevenueCatMobileOptions {
  /** Public SDK keys from RevenueCat → Project → API keys (appl_… and goog_…). Safe to ship in the app. */
  iosKey?: string;
  androidKey?: string;
  /** In the order the app wants them shown. */
  plans: RevenueCatPlan[];
  /** Tiers lowest first, starting with 'free'. Must match the payments kit's tiers. */
  tiers?: readonly string[];
  /** Entitlement id in RevenueCat for each paid tier. Default: the tier's own name. */
  entitlements?: Record<string, string>;
  /** A RevenueCat offering id; default is the current offering. */
  offering?: string;
  messages?: Partial<PaymentMessages>;
  debugLogs?: boolean;
}


/** Turns a store error into a result the app can show. */
export function failure(e: unknown, m: PaymentMessages = DEFAULT_MESSAGES): BuyResult {
  const err = e as { code?: string; userCancelled?: boolean } | null;
  const code = err?.code;
  if (err?.userCancelled || code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return { ok: false, cancelled: true, message: '' };
  if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return { ok: false, cancelled: false, pending: true, message: m.pending };
  if (code === PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR) return { ok: false, cancelled: false, message: m.notAllowed };
  if (code === PURCHASES_ERROR_CODE.NETWORK_ERROR) return { ok: false, cancelled: false, message: m.network };
  if (code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR) return { ok: false, cancelled: false, message: m.alreadyOwned };
  return { ok: false, cancelled: false, message: m.generic };
}

/** RevenueCat for the App Store and Google Play (iPhone and Android apps). For the website use `revenueCatWeb`. */
export function revenueCatMobile(options: RevenueCatMobileOptions): PaymentProvider {
  const tiers = normalizeTiers(options.tiers);
  const m: PaymentMessages = { ...DEFAULT_MESSAGES, ...options.messages };
  const key = (Platform.OS === 'ios' ? options.iosKey : Platform.OS === 'android' ? options.androidKey : '') ?? '';
  const ready = Platform.OS !== 'web' && key.length > 0;
  // The last customer info seen, so renewal() can say when the tier ends without another store call.
  let last: CustomerInfo | null = null;
  const tierFor = (info: CustomerInfo | null | undefined) => {
    last = info ?? null;
    return tierOf(info, tiers, options.entitlements);
  };

  let configured = false;
  let current: string | null = null;

  /** Makes sure the store is signed in as this account, so a purchase is never booked to the last person on this phone. */
  async function storeIsFor(userId: string | null): Promise<boolean> {
    if (!userId) return true;
    try {
      if ((await Purchases.getAppUserID()) === userId) return true;
      await Purchases.logIn(userId);
      current = userId;
      return (await Purchases.getAppUserID()) === userId;
    } catch {
      return false;
    }
  }
  const notSignedIn: BuyResult = { ok: false, cancelled: false, message: m.notSignedIn };

  return {
    name: 'revenuecat-mobile',
    ready,
    async start(userId) {
      if (!ready) return;
      if (!configured) {
        if (options.debugLogs) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
        Purchases.configure({ apiKey: key, appUserID: userId ?? undefined });
        configured = true;
        current = userId;
        return;
      }
      // On failure this throws and `current` stays as it was, so the next start() tries again.
      if (userId && userId !== current) await Purchases.logIn(userId);
      if (!userId && current) await Purchases.logOut().catch(() => undefined);
      current = userId;
    },
    async loadPlans() {
      if (!ready || !configured) return [];
      const all = await Purchases.getOfferings();
      const offering = options.offering ? all.all[options.offering] : all.current;
      if (!offering) return [];
      const found = options.plans.flatMap((p) => {
        const pkg = findPackage(offering.availablePackages, p);
        return pkg ? [{ p, pkg }] : [];
      });
      // A free trial shows only if this person can still use it (one per person). Android already leaves a used trial out; iPhone must ask.
      let eligible: Record<string, { status: number }> = {};
      if (Platform.OS === 'ios' && found.length) {
        eligible = await Purchases.checkTrialOrIntroductoryPriceEligibility(found.map((x) => x.pkg.product.identifier)).catch(() => ({}));
      }
      return found.map(({ p, pkg }): Plan => {
        const intro = pkg.product.introPrice;
        const canTrial = Platform.OS !== 'ios' || eligible[pkg.product.identifier]?.status === Purchases.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
        return {
          id: p.id,
          tier: p.tier,
          priceString: pkg.product.priceString,
          price: pkg.product.price,
          currency: pkg.product.currencyCode,
          period: parsePeriod(pkg.product.subscriptionPeriod),
          trialDays: intro && intro.price === 0 && canTrial ? periodDays(intro.periodUnit, intro.periodNumberOfUnits) : null,
          native: pkg,
        };
      });
    },
    async buy(plan, userId) {
      if (!ready || !configured) return { ok: false, cancelled: false, message: m.notReady };
      if (!plan.native) return { ok: false, cancelled: false, message: m.storeUnreachable };
      if (!(await storeIsFor(userId))) return notSignedIn;
      try {
        const { customerInfo } = await Purchases.purchasePackage(plan.native as PurchasesPackage);
        return { ok: true, tier: tierFor(customerInfo) };
      } catch (e) {
        return failure(e, m);
      }
    },
    async restore(userId) {
      if (!ready || !configured) return { ok: false, cancelled: false, message: m.notReady };
      if (!(await storeIsFor(userId))) return notSignedIn;
      try {
        return { ok: true, tier: tierFor(await Purchases.restorePurchases()) };
      } catch (e) {
        return failure(e, m);
      }
    },
    async currentTier() {
      if (!ready || !configured) return FREE;
      return tierFor(await Purchases.getCustomerInfo());
    },
    onTierChange(cb) {
      if (!ready || !configured) return () => undefined;
      const listener = (info: CustomerInfo) => cb(tierFor(info));
      Purchases.addCustomerInfoUpdateListener(listener);
      return () => { Purchases.removeCustomerInfoUpdateListener(listener); };
    },
    async redeemCode(code) {
      // Apple shows its own code sheet; Google Play redeems codes in the Play Store.
      if (Platform.OS === 'ios') return Purchases.presentCodeRedemptionSheet();
      await Linking.openURL(`https://play.google.com/redeem?code=${encodeURIComponent(code.trim())}`);
    },
    renewal() {
      return renewalOf(last, tierOf(last, tiers, options.entitlements), options.entitlements);
    },
    async openManage() {
      // Apple's own sheet inside the app. Unlike the App Store page, it also lists TestFlight and sandbox subscriptions.
      if (Platform.OS !== 'ios' || !ready || !configured) return false;
      await Purchases.showManageSubscriptions();
      return true;
    },
    async refresh() {
      if (!ready || !configured) return;
      await Purchases.invalidateCustomerInfoCache();
      tierFor(await Purchases.getCustomerInfo());
    },
    async loadOffer(offerId) {
      // Promotional offers are App Store only; Google Play has no matching kind.
      if (Platform.OS !== 'ios' || !ready || !configured) return null;
      for (const plan of await this.loadPlans()) {
        const pkg = plan.native as PurchasesPackage | undefined;
        const d = pkg?.product.discounts?.find((x: PurchasesStoreProductDiscount) => x.identifier === offerId);
        if (pkg && d) {
          return { id: offerId, plan, priceString: d.priceString, price: d.price, cycles: d.cycles, period: { unit: d.periodUnit as PeriodUnit, count: d.periodNumberOfUnits }, native: d };
        }
      }
      return null;
    },
    async buyOffer(offer: Offer, userId) {
      if (!ready || !configured) return { ok: false, cancelled: false, message: m.notReady };
      const pkg = offer.plan.native as PurchasesPackage | undefined;
      if (!pkg || !offer.native) return { ok: false, cancelled: false, message: m.storeUnreachable };
      if (!(await storeIsFor(userId))) return notSignedIn;
      try {
        // RevenueCat signs the offer with the In-App Purchase key uploaded to it; without one this is undefined.
        const signed = await Purchases.getPromotionalOffer(pkg.product, offer.native as PurchasesStoreProductDiscount);
        if (!signed) return { ok: false, cancelled: false, message: m.storeUnreachable };
        const { customerInfo } = await Purchases.purchaseDiscountedPackage(pkg, signed);
        return { ok: true, tier: tierFor(customerInfo) };
      } catch (e) {
        return failure(e, m);
      }
    },
    manageUrl() {
      return Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : Platform.OS === 'android' ? 'https://play.google.com/store/account/subscriptions' : null;
    },
  };
}
