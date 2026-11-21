import { AppState, Linking, Platform } from 'react-native';
import { DEFAULT_MESSAGES, type PaymentMessages } from './messages';
import { FREE, highest, normalizeTiers, rank } from './tiers';
import type { BuyResult, Offer, Plan, PaymentProvider, Renewal, ServerSubscription, SubscriptionBackend } from './types';

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
interface Remembered {
  tier: string;
  renewal: Renewal | null;
}

const TESTER_KEY = 'payments-kit:tester-tier';
const LAST_KEY = (id: string) => `payments-kit:last-tier:${id}`;
/** How long a store start may take before the kit counts it as failed and tries again later (RevenueCat's logIn can hang offline). */
export const STORE_START_TIMEOUT_MS = 15_000;
/** After a failed store check: try again after 2 s, then twice as long each time, up to every 2 minutes. */
export const STORE_RETRY_MS = (attempt: number) => Math.min(2000 * 2 ** attempt, 120_000);
const MANAGE: Record<string, string> = {
  ios: 'https://apps.apple.com/account/subscriptions',
  android: 'https://play.google.com/store/account/subscriptions',
};

export function createPaymentsKit(options: PaymentsKitOptions) {
  const tiers = normalizeTiers(options.tiers);
  const os = Platform.OS as string;
  const provider = options.providers[os as 'ios'] ?? options.providers.default ?? null;
  const messages: PaymentMessages = { ...DEFAULT_MESSAGES, ...options.messages };
  const report = (where: string, e: unknown) => options.onError?.(where, e);
  const ready = !!provider?.ready;
  const storage = options.storage ?? options.testerStorage;

  let userId: string | null = null;
  let testerTier: string | null = null;
  const testerListeners = new Set<(t: string | null) => void>();
  const testerLoaded = options.tester && options.testerStorage
    ? options.testerStorage.getItem(TESTER_KEY).then((v) => { if (v && tiers.includes(v) && v !== FREE) testerTier = v; }).catch((e) => report('payments:tester', e))
    : Promise.resolve();

  const notReady: BuyResult = { ok: false, cancelled: false, message: messages.notReady };
  /** Each watch() adds its own "check again", so refresh() can update every screen at once. */
  const checkers = new Set<() => void>();
  let later: ReturnType<typeof setTimeout>[] = [];
  /**
   * What the person can change in the manage sheet (auto-renew on or off, the plan), as text, to tell when it has changed.
   * The end date and the trial flag are left out: they can change on their own (a renewal, a trial turning paid) and must not stop
   * the checks before the real change shows. Watchers still hear about them, because every check tells every watcher.
   */
  const renewalNow = () => {
    const r = provider?.renewal?.() ?? null;
    return JSON.stringify(r ? [r.willRenew, r.productId ?? null] : null);
  };
  /** Apple can take a few seconds to pass a change to the store service, so a refresh looks again after these. */
  // Apple takes a few seconds to pass a change on: look every 2 seconds at first, then less often, for 45 seconds.
  /** The longest watch() waits for the store's first answer before it reports what it has (the store may be offline). */
  const STORE_WAIT_MS = 5000;
  const LATER_MS = [2000, 4000, 6000, 8000, 10000, 12000, 15000, 20000, 30000, 45000];

  /** True when the server row gives this tier right now. */
  const serverTier = (row: ServerSubscription | null): string => {
    if (!row || !row.activeUntil || Date.parse(row.activeUntil) <= Date.now()) return FREE;
    return tiers.includes(row.tier) ? row.tier : FREE;
  };

  const kit = {
    tiers,
    provider,
    /** False where no provider can sell (no key, Expo Go without a store): show "purchases open soon", never fake prices. */
    ready,
    messages,

    /** Call on sign-in and sign-out (null), so purchases follow the account to a new phone. */
    async start(id: string | null): Promise<void> {
      // Another account (or none): the last one's pending re-checks after the manage sheet are of no use any more.
      if (id !== userId) {
        later.forEach(clearTimeout);
        later = [];
      }
      userId = id;
      if (ready) await provider!.start(id);
    },
    stop: () => kit.start(null),

    async loadPlans(): Promise<Plan[]> {
      return ready ? provider!.loadPlans() : [];
    },
    async buy(plan: Plan): Promise<BuyResult> {
      return ready ? provider!.buy(plan, userId) : notReady;
    },
    async restore(): Promise<BuyResult> {
      return ready ? provider!.restore(userId) : notReady;
    },
    /** False where there is no code box to offer (the website has none): hide "Have a code?". */
    canRedeemCode: ready && !!provider!.redeemCode,
    async redeemCode(code = ''): Promise<void> {
      if (ready && provider!.redeemCode) return provider!.redeemCode(code);
    },
    /** The store's own page to change or cancel; null where there is none. */
    manageUrl(): string | null {
      return provider?.manageUrl?.() ?? MANAGE[os] ?? null;
    },
    /**
     * The store's own manage screen inside the app where there is one, else its manage page.
     * `onClosed` runs once, the moment the in-app screen closes (before the store is asked again), so a page can show its loader
     * straight away instead of after the checks. It is not called when the store's web page opens instead.
     */
    async openManage(onClosed?: () => void): Promise<void> {
      if (ready && provider!.openManage) {
        try {
          // What the store said before the sheet opened, so the checks after it can stop once the change shows.
          const before = renewalNow();
          let told = false;
          const closed = () => {
            if (told) return;
            told = true;
            try { onClosed?.(); } catch (e) { report('payments:manage', e); }
          };
          if (await provider!.openManage(userId, closed)) {
            closed(); // a provider from before 2.5.0 never calls it
            await kit.refresh(before);
            return;
          }
        } catch (e) {
          report('payments:manage', e);
        }
      }
      const url = kit.manageUrl();
      if (url) await Linking.openURL(url);
    },

    /**
     * Asks the store again now (not its saved copy) and tells every watcher, then a few more times over the next 45 seconds. The in-app
     * manage sheet never sends the app to the background, so without this a cancel or renew there shows only minutes later.
     * With `before` (the store's renewal before a change), the store is not asked again once it shows something else; with a
     * backend, the server row is still read for the whole 45 seconds, since the webhook lands after the store has changed.
     */
    async refresh(before?: string): Promise<void> {
      const stop = () => {
        later.forEach(clearTimeout);
        later = [];
      };
      // Once the store shows the change, it is no longer asked again. The server row still is, for the whole window: the
      // webhook that updates it usually lands after the store has changed, and a row read once, too early, would stay stale.
      let storeDone = false;
      const changed = () => before !== undefined && renewalNow() !== before;
      const once = async () => {
        try {
          if (ready && !storeDone) await provider!.refresh?.();
        } catch (e) {
          report('payments:refresh', e);
        }
        checkers.forEach((c) => c());
        if (!storeDone && changed()) {
          storeDone = true;
          if (!options.backend) stop();
        }
      };
      // A newer refresh replaces the later checks of an older one, so repeated calls don't pile up.
      stop();
      await once();
      if (storeDone && !options.backend) return;
      later = LATER_MS.map((ms) => setTimeout(() => void once(), ms));
    },

    /** A discount for people who already subscribe, by its store id; null where the store has none (or can't have one). */
    async loadOffer(offerId: string): Promise<Offer | null> {
      if (!ready || !provider!.loadOffer || !offerId) return null;
      try {
        return await provider!.loadOffer(offerId);
      } catch (e) {
        report('payments:offer', e);
        return null;
      }
    },
    async buyOffer(offer: Offer): Promise<BuyResult> {
      if (!ready || !provider!.buyOffer) return notReady;
      return provider!.buyOffer(offer, userId);
    },

    /** The developer switch is offered only when `tester` is on (development builds). */
    testerAvailable: !!options.tester,
    async getTesterTier(): Promise<string | null> {
      await testerLoaded;
      return options.tester ? testerTier : null;
    },
    /** Pretend this phone has a tier ('free' or null turns it off). Never reaches the server. */
    async setTesterTier(tier: string | null): Promise<void> {
      if (!options.tester) return;
      testerTier = tier && tier !== FREE && tiers.includes(tier) ? tier : null;
      testerListeners.forEach((l) => l(testerTier));
      await options.testerStorage?.setItem(TESTER_KEY, testerTier ?? '').catch((e) => report('payments:tester', e));
    },

    /** The server row for this account, or null (no backend, signed out, offline). */
    async readServer(id = userId): Promise<ServerSubscription | null> {
      if (!options.backend || !id) return null;
      return options.backend.read(id);
    },

    /**
     * Follows the tier for this account: the store, the server row and the tester switch, whichever is highest.
     * Checks again whenever the app comes back to the front. Returns a function that stops watching.
     */
    watch(id: string | null | undefined, cb: (state: TierState) => void): () => void {
      // undefined: the app is still restoring the session. Nothing is started and nothing reported until it knows who it is,
      // so the store is never set up on an anonymous id only to need a network call to move to the real account.
      if (id === undefined) return () => undefined;
      let live = true;
      let store = FREE;
      /** True once the store has answered in this watch; until then the account's remembered tier stands in for it. */
      let storeKnown = false;
      let remembered: Remembered | null = null;
      let server: ServerSubscription | null = null;
      let stopStore = () => undefined as void;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let attempt = 0;
      let failing = false;
      // Nothing is reported until the account's row has been read once (or the read failed), so an app never shows
      // a paying family "free" for the moment before the server answers. Without a backend or an account there is
      // nothing to wait for.
      let settled = !options.backend || !id;
      // Nor until the store has answered once (or failed, or STORE_WAIT_MS passed, or this account's remembered answer was read):
      // without it a Premium account reads "free" for a moment at every launch.
      let storeSettled = !ready;
      const storeWait = ready ? setTimeout(() => { storeSettled = true; emit(); }, STORE_WAIT_MS) : undefined;
      /** The remembered tier while it is still paid for: its end date is ahead (or it has none, a lifetime purchase). */
      const stillValid = (r: Remembered | null): r is Remembered => {
        if (!r || r.tier === FREE || !tiers.includes(r.tier)) return false;
        const until = r.renewal?.until;
        return !until || Date.parse(until) > Date.now();
      };
      let lastEmitted = '';
      const emit = () => {
        if (!live || !settled || !storeSettled) return;
        const t = options.tester ? testerTier : null;
        const fromServer = serverTier(server);
        const fallback = !storeKnown && stillValid(remembered) ? remembered : null;
        const fromStore = storeKnown ? store : fallback ? fallback.tier : FREE;
        const tier = highest(tiers, fromStore, fromServer, t);
        const source: TierSource = tier === FREE ? 'free' : rank(tiers, fromStore) === rank(tiers, tier) ? 'store' : rank(tiers, fromServer) === rank(tiers, tier) ? 'account' : 'tester';
        const renewal = source !== 'store' ? null : fallback ? fallback.renewal : provider?.renewal?.() ?? null;
        const state: TierState = fallback && source === 'store' ? { tier, source, server, renewal, remembered: true } : { tier, source, server, renewal };
        // Before the store answers, the same state reported again (the server read, the tester switch loading) tells nothing new.
        const text = JSON.stringify(state);
        if (!storeKnown && text === lastEmitted) return;
        lastEmitted = text;
        cb(state);
      };
      /** Saves what the store just said for this account, for a launch when the store can't be reached. */
      let saved = '';
      const remember = (t: string) => {
        if (!id || !storage) return;
        const r: Remembered = { tier: t, renewal: t === FREE ? null : provider?.renewal?.() ?? null };
        const text = JSON.stringify(r);
        if (text === saved) return; // the store repeats itself on every return to the app
        saved = text;
        storage.setItem(LAST_KEY(id), text).catch((e) => report('payments:remember', e));
      };
      const loaded: Promise<void> = id && storage && ready
        ? storage.getItem(LAST_KEY(id)).then((raw) => {
            const v = raw ? (JSON.parse(raw) as Partial<Remembered>) : null;
            if (v && typeof v.tier === 'string') remembered = { tier: v.tier, renewal: v.renewal && typeof v.renewal === 'object' ? v.renewal : null };
          }).catch((e) => report('payments:remember', e))
        : Promise.resolve();
      const heard = (t: string) => {
        store = t;
        storeKnown = true;
        remember(t);
      };
      const checkServer = () => kit.readServer(id).then((row) => { server = row; }).catch((e) => report('payments:server', e)).finally(() => { settled = true; emit(); });
      const checkStore = async () => {
        if (!ready) return;
        clearTimeout(retry);
        retry = undefined;
        let ok = false;
        try {
          // A start that hangs (RevenueCat's logIn offline) counts as failed after a while, so the kit can try again.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timedOut = new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error('store start timed out')), STORE_START_TIMEOUT_MS); });
          try {
            await Promise.race([kit.start(id), timedOut]);
          } finally {
            clearTimeout(timer);
          }
          if (!live) return;
          stopStore();
          stopStore = provider!.onTierChange((t) => { heard(t); emit(); });
          const t = await provider!.currentTier();
          // Stopped while the store answered (a sign-out, then someone else): the answer may be the next account's, so it is
          // neither reported nor saved under this one.
          if (!live) return;
          heard(t);
          ok = true;
        } catch (e) {
          report('payments:store', e);
        }
        if (!live) return;
        await loaded;
        storeSettled = true;
        clearTimeout(storeWait);
        failing = !ok;
        if (ok) attempt = 0;
        else retry = setTimeout(() => void checkStore(), STORE_RETRY_MS(attempt++));
        emit();
      };
      const check = () => { void checkServer(); void checkStore(); };
      const onTester = () => emit();
      testerListeners.add(onTester);
      checkers.add(check);
      void testerLoaded.then(emit);
      // A remembered answer for this account (free, or paid and not yet ended) is reported as soon as it is read, without waiting
      // for the store: the store's answer follows and is reported again. With none (or an ended paid one), the kit still waits for the
      // store, up to STORE_WAIT_MS, so a paying account never reads "free" for a moment.
      void loaded.then(() => {
        if (live && !storeSettled && remembered && (remembered.tier === FREE || stillValid(remembered))) {
          storeSettled = true;
          clearTimeout(storeWait);
        }
        emit();
      });
      check();
      const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
      // Back online after a failed check: try the store (and the row) at once instead of waiting for the next retry.
      const offOnline = options.onOnline?.(() => { if (live && failing) check(); }) ?? (() => undefined);
      return () => { live = false; clearTimeout(storeWait); clearTimeout(retry); stopStore(); sub.remove(); offOnline(); testerListeners.delete(onTester); checkers.delete(check); };
    },
  };
  return kit;
}

export type PaymentsKit = ReturnType<typeof createPaymentsKit>;
