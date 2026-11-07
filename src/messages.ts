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
}

export const DEFAULT_MESSAGES: PaymentMessages = {
  notReady: 'Purchases are not open on this device yet.',
  storeUnreachable: 'Could not reach the store. Check the connection and try again.',
  notSignedIn: 'Could not confirm your account with the store. Check the connection and try again.',
  pending: 'The payment is waiting for approval. Your plan turns on as soon as it goes through.',
  notAllowed: 'Purchases are turned off on this device (for example by Screen Time or Family Link).',
  network: 'No internet connection. Please try again.',
  alreadyOwned: 'You already have this plan. Tap Restore purchases to turn it on here.',
  generic: 'The store could not finish this. Please try again in a moment.',
};

/** Days in a store period, such as WEEK × 1 = 7. */
export const periodDays = (unit: string, count: number): number =>
  count * (unit === 'WEEK' ? 7 : unit === 'MONTH' ? 30 : unit === 'YEAR' ? 365 : 1);
