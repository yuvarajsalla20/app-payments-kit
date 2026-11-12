import { AppState, Linking, Platform } from 'react-native';
import { DEFAULT_MESSAGES, type PaymentMessages } from './messages';
import { FREE, highest, normalizeTiers, rank } from './tiers';
import type { BuyResult, Plan, PaymentProvider, Renewal, ServerSubscription, SubscriptionBackend } from './types';

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
}

const TESTER_KEY = 'payments-kit:tester-tier';
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

  let userId: string | null = null;
  let testerTier: string | null = null;
  const testerListeners = new Set<(t: string | null) => void>();
  const testerLoaded = options.tester && options.testerStorage
    ? options.testerStorage.getItem(TESTER_KEY).then((v) => { if (v && tiers.includes(v) && v !== FREE) testerTier = v; }).catch((e) => report('payments:tester', e))
    : Promise.resolve();

  const notReady: BuyResult = { ok: false, cancelled: false, message: messages.notReady };

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
    /** The store's own manage screen inside the app where there is one, else its manage page. */
    async openManage(): Promise<void> {
      if (ready && provider!.openManage) {
        try {
          if (await provider!.openManage()) return;
        } catch (e) {
          report('payments:manage', e);
        }
      }
      const url = kit.manageUrl();
      if (url) await Linking.openURL(url);
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
    watch(id: string | null, cb: (state: TierState) => void): () => void {
      let live = true;
      let store = FREE;
      let server: ServerSubscription | null = null;
      let stopStore = () => undefined as void;
      // Nothing is reported until the account's row has been read once (or the read failed), so an app never shows
      // a paying family "free" for the moment before the server answers. Without a backend or an account there is
      // nothing to wait for.
      let settled = !options.backend || !id;
      const emit = () => {
        if (!live || !settled) return;
        const t = options.tester ? testerTier : null;
        const fromServer = serverTier(server);
        const tier = highest(tiers, store, fromServer, t);
        const source: TierSource = tier === FREE ? 'free' : rank(tiers, store) === rank(tiers, tier) ? 'store' : rank(tiers, fromServer) === rank(tiers, tier) ? 'account' : 'tester';
        const renewal = source === 'store' ? provider?.renewal?.() ?? null : null;
        cb({ tier, source, server, renewal });
      };
      const checkServer = () => kit.readServer(id).then((row) => { server = row; }).catch((e) => report('payments:server', e)).finally(() => { settled = true; emit(); });
      const checkStore = async () => {
        if (!ready) return;
        try {
          await kit.start(id);
          if (!live) return;
          stopStore();
          stopStore = provider!.onTierChange((t) => { store = t; emit(); });
          store = await provider!.currentTier();
          emit();
        } catch (e) {
          report('payments:store', e);
        }
      };
      const check = () => { void checkServer(); void checkStore(); };
      const onTester = () => emit();
      testerListeners.add(onTester);
      void testerLoaded.then(emit);
      check();
      const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
      return () => { live = false; stopStore(); sub.remove(); testerListeners.delete(onTester); };
    },
  };
  return kit;
}

export type PaymentsKit = ReturnType<typeof createPaymentsKit>;
