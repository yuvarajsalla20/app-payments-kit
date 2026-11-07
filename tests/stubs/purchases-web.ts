// Stand-in for @revenuecat/purchases-js with a fake Web Billing account the tests control.
export enum ErrorCode {
  UnknownError = 0,
  UserCancelledError = 1,
  PurchaseNotAllowedError = 3,
  ProductAlreadyPurchasedError = 6,
  NetworkError = 10,
  PaymentPendingError = 20,
}

const webPkg = (packageType: string, price: number, period: string, trial?: string) => {
  const product = {
    identifier: `web_${packageType.toLowerCase()}`,
    currentPrice: { amountMicros: Math.round(price * 1_000_000), currency: 'USD', formattedPrice: `$${price.toFixed(2)}` },
    normalPeriodDuration: period,
    defaultSubscriptionOption: { trial: trial ? { periodDuration: trial } : null },
  };
  return { identifier: `$rc_${packageType.toLowerCase()}`, packageType, webBillingProduct: product, rcBillingProduct: product, product };
};

const info = () => ({ entitlements: { active: Object.fromEntries(web.active.map((a) => [a, { identifier: a }])), all: {} }, managementURL: web.manage });

class FakePurchases {
  getAppUserId() { return web.user; }
  async changeUser(id: string) { web.user = id; return info(); }
  async getOfferings() { return { all: { alt: { availablePackages: web.packages.slice(1) } }, current: { availablePackages: web.packages } }; }
  async getCustomerInfo() { return info(); }
  async purchase({ rcPackage, customerEmail }: { rcPackage: unknown; customerEmail?: string }) {
    if (web.fail !== null) throw Object.assign(new Error('x'), { errorCode: web.fail });
    web.bought.push({ pkg: rcPackage, email: customerEmail, user: web.user });
    web.active.push('premium');
    web.manage = 'https://pay.rev.cat/manage';
    return { customerInfo: info(), redemptionInfo: null };
  }
}
let instance: FakePurchases | null = null;

export const web = {
  configured: [] as { apiKey: string; appUserId: string }[],
  user: '',
  active: [] as string[],
  manage: null as string | null,
  fail: null as number | null,
  bought: [] as { pkg: unknown; email?: string; user: string }[],
  packages: [webPkg('ANNUAL', 39.99, 'P1Y', 'P7D'), webPkg('MONTHLY', 6.99, 'P1M')],
  clear() {
    web.configured = [];
    web.user = '';
    web.active = [];
    web.manage = null;
    web.fail = null;
    web.bought = [];
    instance = null;
  },
};

export const Purchases = {
  isConfigured: () => instance !== null,
  getSharedInstance: () => instance!,
  configure(c: { apiKey: string; appUserId: string }) {
    web.configured.push(c);
    web.user = c.appUserId;
    instance = new FakePurchases();
    return instance;
  },
};
export type Purchases = FakePurchases;
export type CustomerInfo = ReturnType<typeof info>;
export type Package = (typeof web.packages)[number];
