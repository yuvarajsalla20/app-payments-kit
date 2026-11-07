// Stand-in for react-native-purchases with a fake store the tests control.
import type { CustomerInfo } from 'react-native-purchases';

export const LOG_LEVEL = { DEBUG: 'DEBUG', WARN: 'WARN' };
export const PURCHASES_ERROR_CODE = {
  PURCHASE_CANCELLED_ERROR: '1',
  PAYMENT_PENDING_ERROR: '20',
  PURCHASE_NOT_ALLOWED_ERROR: '3',
  NETWORK_ERROR: '10',
  PRODUCT_ALREADY_PURCHASED_ERROR: '6',
};
export const info = (...active: string[]) => ({ entitlements: { active: Object.fromEntries(active.map((a) => [a, { identifier: a }])) } }) as unknown as CustomerInfo;

const pkg = (packageType: string, id: string, price: number, period: string | null, trial?: { unit: string; n: number }) => ({
  identifier: `$rc_${packageType.toLowerCase()}`,
  packageType,
  product: {
    identifier: id,
    price,
    priceString: `$${price.toFixed(2)}`,
    currencyCode: 'USD',
    subscriptionPeriod: period,
    introPrice: trial ? { price: 0, periodUnit: trial.unit, periodNumberOfUnits: trial.n } : null,
  },
});

export const store = {
  user: null as string | null,
  configured: [] as unknown[],
  failLogIn: false,
  customer: info(),
  packages: [pkg('ANNUAL', 'gp_yearly', 39.99, 'P1Y', { unit: 'WEEK', n: 1 }), pkg('MONTHLY', 'gp_monthly', 6.99, 'P1M')],
  eligible: 2,
  buyError: null as unknown,
  listeners: new Set<(i: CustomerInfo) => void>(),
  reset() {
    this.user = null;
    this.configured = [];
    this.failLogIn = false;
    this.customer = info();
    this.eligible = 2;
    this.buyError = null;
    this.listeners.clear();
  },
};

const Purchases = {
  INTRO_ELIGIBILITY_STATUS: { INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2 },
  setLogLevel: () => undefined,
  configure: (o: { appUserID?: string }) => {
    store.configured.push(o);
    store.user = o.appUserID ?? '$RCAnonymousID:x';
  },
  logIn: async (id: string) => {
    if (store.failLogIn) throw new Error('offline');
    store.user = id;
    return { customerInfo: store.customer, created: false };
  },
  logOut: async () => {
    store.user = '$RCAnonymousID:y';
    return store.customer;
  },
  getAppUserID: async () => store.user,
  getOfferings: async () => ({ current: { availablePackages: store.packages }, all: { promo: { availablePackages: store.packages.slice(1) } } }),
  checkTrialOrIntroductoryPriceEligibility: async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { status: store.eligible }])),
  purchasePackage: async () => {
    if (store.buyError) throw store.buyError;
    store.customer = info('premium');
    return { customerInfo: store.customer };
  },
  restorePurchases: async () => store.customer,
  getCustomerInfo: async () => store.customer,
  addCustomerInfoUpdateListener: (l: (i: CustomerInfo) => void) => void store.listeners.add(l),
  removeCustomerInfoUpdateListener: (l: (i: CustomerInfo) => void) => store.listeners.delete(l),
  presentCodeRedemptionSheet: async () => undefined,
};
export default Purchases;
