import { FREE } from './tiers';
import type { PaymentMessages } from './messages';
import type { PaymentProvider, Renewal, ServerSubscription, SubscriptionBackend } from './types';

/** Saves the developer-only "pretend tier" switch between app starts (AsyncStorage fits). */
export interface TesterStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface PaymentsKitOptions {
  /** One provider per platform; `default` is used where none is named. */
  providers: Partial<Record<'ios' | 'android' | 'web' | 'default', PaymentProvider>>;
  /** Tiers lowest first, starting with 'free'. Default ['free', 'premium']. */
  tiers?: readonly string[];
  /** Reads the account's row that the webhook keeps up to date, so Premium bought on another device or granted by hand counts. */
  backend?: SubscriptionBackend;
  /** Turns on the "pretend tier" switch. Pass `__DEV__` so store builds never show it. */
  tester?: boolean;
  testerStorage?: TesterStorage;
  messages?: Partial<PaymentMessages>;
  /** Called with errors the kit swallows (app-core-kit's reportError fits). */
  onError?: (where: string, error: unknown) => void;
  /**
   * Keeps each account's last tier from the store (and its end date), so a paying account still reads as paid when the store
   * can't be reached at launch (offline, a slow sign-in). AsyncStorage fits. Default: `testerStorage`, when given.
   */
  storage?: TesterStorage;
  /**
   * Calls back when the device is online again, so a store check that failed is tried at once (it is also retried on its own,
   * less and less often). Returns a function that stops listening. With NetInfo:
   * `(cb) => NetInfo.addEventListener((s) => { if (s.isConnected) cb(); })`.
   */
  onOnline?: (cb: () => void) => () => void;
}

/** Where the current tier came from, for support screens and the Settings row. */
export type TierSource = 'free' | 'store' | 'account' | 'tester';
export interface TierState {
  tier: string;
  source: TierSource;
  /** The server row, when there is one. */
  server: ServerSubscription | null;
  /** When the store's paid tier ends or renews, and whether it renews; null unless the tier comes from the store. */
  renewal: Renewal | null;
  /**
   * True while the store has not answered yet (still starting, or unreachable) and the tier is this account's last known one, kept
   * until its end date (2.7.0+). From 2.8.0 it is reported at once on launch, before the store answers. The kit keeps asking the
   * store and reports again as soon as it answers.
   */
  remembered?: boolean;
}

/** One account's last answer from the store, kept between launches. */
export interface Remembered {
  tier: string;
  renewal: Renewal | null;
}

export const TESTER_KEY = 'payments-kit:tester-tier';
export const LAST_KEY = (id: string) => `payments-kit:last-tier:${id}`;
/** How long a store start may take before the kit counts it as failed and tries again later (RevenueCat's logIn can hang offline). */
export const STORE_START_TIMEOUT_MS = 15_000;
/** After a failed store check: try again after 2 s, then twice as long each time, up to every 2 minutes. */
export const STORE_RETRY_MS = (attempt: number) => Math.min(2000 * 2 ** attempt, 120_000);
export const MANAGE: Record<string, string> = {
  ios: 'https://apps.apple.com/account/subscriptions',
  android: 'https://play.google.com/store/account/subscriptions',
};
/** The longest watch() waits for the store's first answer before it reports what it has (the store may be offline). */
export const STORE_WAIT_MS = 5000;
/** How soon the app must leave for the store's page, and the longest it may stay away, for the checks on return to run. */
export const LEAVE_MS = 3000;
export const AWAY_MS = 30 * 60_000;
/** Apple takes a few seconds to pass a change on: a refresh looks every 2 seconds at first, then less often, for 45 seconds. */
export const LATER_MS = [2000, 4000, 6000, 8000, 10000, 12000, 15000, 20000, 30000, 45000];

/** The tier the server row gives right now: free when there is none, it has ended, or its tier is not one of `tiers`. */
export const serverTierOf = (row: ServerSubscription | null, tiers: readonly string[]): string => {
  if (!row || !row.activeUntil || Date.parse(row.activeUntil) <= Date.now()) return FREE;
  return tiers.includes(row.tier) ? row.tier : FREE;
};
