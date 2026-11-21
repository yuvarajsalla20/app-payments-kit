/** Every message the kit can show, so an app can reword or translate it. */
export interface PaymentMessages {
  notReady: string;
  storeUnreachable: string;
  notSignedIn: string;
  pending: string;
  notAllowed: string;
  network: string;
  alreadyOwned: string;
  generic: string;
  /** 2.9.0: a subscription bought on iPhone, seen on another phone. */
  billedByAppStore: string;
  /** 2.9.0: a subscription bought on Android, seen on another phone. */
  billedByGooglePlay: string;
  /** 2.9.0: a subscription bought on the website, seen on a phone. */
  billedOnWeb: string;
}

export const DEFAULT_MESSAGES: PaymentMessages = {
  notReady: 'Purchases are not open on this device yet.',
  storeUnreachable: 'Could not reach the store. Check the connection and try again.',
  notSignedIn: 'Could not confirm your account with the store. Check the connection and try again.',
  pending: 'The payment is waiting for approval. Your plan turns on as soon as it goes through.',
  notAllowed: 'Purchases are turned off on this device (for example by Screen Time or Family Link).',
  network: 'No internet connection. Please try again.',
  alreadyOwned: 'You already have this plan. Tap Restore Purchases to turn it on here.',
  generic: 'The store could not finish this. Please try again in a moment.',
  billedByAppStore: 'Your subscription is billed through the App Store. Please manage it on your iPhone.',
  billedByGooglePlay: 'Your subscription is billed through Google Play. Please manage it on your Android phone.',
  billedOnWeb: 'Your subscription is billed through the website. Please manage it there.',
};

/**
 * Days in a store period, such as WEEK × 1 = 7. Exact for DAY and WEEK only: a MONTH counts as 30 and a YEAR as 365, though
 * the stores run them by the calendar. To say how long a trial is, use the period itself (`Plan.trial`), not this.
 */
export const periodDays = (unit: string, count: number): number =>
  count * (unit === 'WEEK' ? 7 : unit === 'MONTH' ? 30 : unit === 'YEAR' ? 365 : 1);
