# app-payments-kit

Payments for React Native and Expo apps (iOS, Android and web). One API over the App Store, Google Play and the website; any number of tiers and plans; an optional server webhook and `subscriptions` table so the database knows who paid; and a developer-only switch to try paid features without buying.

**Current version: 2.9.0** (tag `v2.9.0`)

It has no screens. For the Plans screen, the Premium page, locks and `canUse()`, add [app-subscriptions-kit](https://github.com/yuvarajsalla20/app-subscriptions-kit) on top. For the full App Store Connect, RevenueCat and EAS setup with screenshots, follow the Subscriptions and Payments Playbook in the app's `runbooks/` folder.

Part of the shared kits:
[app-core-kit](https://github.com/yuvarajsalla20/app-core-kit) ·
[app-auth-kit](https://github.com/yuvarajsalla20/app-auth-kit) ·
[app-account-kit](https://github.com/yuvarajsalla20/app-account-kit) ·
[app-settings-kit](https://github.com/yuvarajsalla20/app-settings-kit) ·
[app-subscriptions-kit](https://github.com/yuvarajsalla20/app-subscriptions-kit) ·
**app-payments-kit** ·
[app-export-kit](https://github.com/yuvarajsalla20/app-export-kit) ·
[app-guard-kit](https://github.com/yuvarajsalla20/app-guard-kit) ·
[app-theme-kit](https://github.com/yuvarajsalla20/app-theme-kit) ·
[app-invite-kit](https://github.com/yuvarajsalla20/app-invite-kit) ·
[app-goldrates-api-kit](https://github.com/yuvarajsalla20/app-goldrates-api-kit)

Tools that work alongside them: [code-review-kit](https://github.com/yuvarajsalla20/code-review-kit) (reviews) and app-insights-kit (store numbers, private).

## Install

```jsonc
// package.json
"dependencies": {
  "app-payments-kit": "git+https://github.com/yuvarajsalla20/app-payments-kit.git#<full SHA of v2.9.0>"
},
"kitVersions": {
  "app-payments-kit": "v2.9.0"
}
```

Pin the full commit SHA of a release tag, and write the tag in `kitVersions`. Find a SHA with `git ls-remote https://github.com/yuvarajsalla20/app-payments-kit refs/tags/v2.9.0`.

**Peer dependencies** (all optional except `react-native`; install only the vendors you use):

| Package | Needed for |
|---|---|
| `react-native` ≥ 0.74 | Always |
| `react-native-purchases` ≥ 8 | `app-payments-kit/revenuecat-mobile` (App Store, Google Play). Needs a development build, not Expo Go |
| `@revenuecat/purchases-js` ≥ 1.0 | `app-payments-kit/revenuecat-web` (website) |
| `@supabase/supabase-js` ≥ 2.39 | `app-payments-kit/supabase` (server row) |

## Entry points

| Import | What it holds |
|---|---|
| `app-payments-kit` | `createPaymentsKit`, the tier helpers (`FREE`, `rank`, `highest`, `normalizeTiers`), `DEFAULT_MESSAGES`, `periodDays` and the types. No payment vendor inside |
| `app-payments-kit/revenuecat-mobile` | `revenueCatMobile({ iosKey, androidKey, tiers, plans })`: the App Store and Google Play through RevenueCat |
| `app-payments-kit/revenuecat-web` | `revenueCatWeb({ apiKey, plans })`: card checkout on the website through RevenueCat Web Billing and your Stripe account |
| `app-payments-kit/supabase` | `supabaseBackend(supabase)`: reads the account's own `subscriptions` row |
| `supabase/sql/subscriptions.sql` | Tables `tiers`, `subscriptions`, `subscription_events`; `current_tier(uid)`, `has_tier(uid, tier)`, `is_premium(uid)` for your own rules; row-level security. `subscriptions.down.sql` removes them |
| `supabase/functions/payments-webhook` | The Edge Function the provider calls on every buy, renewal, cancel, refund and transfer. Checks a secret, skips repeats and late events, writes the row |

The server pieces are optional. An app with no server (such as a Firebase app) uses the store alone: `watch()` then reports the tier and `renewal` straight from RevenueCat.

## Quick start

```ts
// payments.ts (one per app)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from 'app-core-kit';
import { createPaymentsKit } from 'app-payments-kit';
import { revenueCatMobile } from 'app-payments-kit/revenuecat-mobile';

const tiers = ['free', 'premium'];         // or ['free', 'plus', 'pro']
const plans = [                            // shown in this order, the same on phone and web
  { id: 'yearly', tier: 'premium', package: 'ANNUAL' },
  { id: 'monthly', tier: 'premium', package: 'MONTHLY' },
];

const mobile = revenueCatMobile({
  iosKey: process.env.EXPO_PUBLIC_RC_IOS_KEY,          // the appl_ key in release builds
  androidKey: process.env.EXPO_PUBLIC_RC_ANDROID_KEY,  // the goog_ key
  tiers,
  plans,
});

export const payments = createPaymentsKit({
  tiers,
  providers: { ios: mobile, android: mobile },         // add web: revenueCatWeb(...) on the website
  // backend: supabaseBackend(supabase),               // optional server row
  tester: __DEV__,                                     // the "pretend tier" switch, never in store builds
  testerStorage: AsyncStorage,
  storage: AsyncStorage,                               // the last known tier per account, for a launch with no connection
  onOnline: (cb) => NetInfo.addEventListener((s) => { if (s.isConnected) cb(); }), // optional: try the store again when back online
  onError: reportError,
});
```

> A RevenueCat `test_` key in a release build would make the SDK close the app. `revenueCatMobile` refuses it there (2.7.0+): `ready` is false, so the Plans screen says purchases are not open, and `onError` (or the console) says why. Use the `appl_` key for preview and production builds.

```ts
// Anywhere
await payments.start(userId);                 // link the signed-in account (null when signed out)
const stop = payments.watch(userId, ({ tier, source, renewal }) => setTier(tier));
// userId: undefined while the app still restores the session (nothing starts), null once signed out
// tier: 'free' | 'premium' …; source: store, account or tester
// renewal: { until, willRenew, productId, trial?, billingIssue? } from the store, so an app without a server can show "Ends Nov 12"
// When the store can't be reached at launch, the account's last known tier is reported (remembered: true) until its end date,
// and the store is tried again (2 s, 4 s, 8 s … up to every 2 minutes, and at once when onOnline fires).

const plans = await payments.loadPlans();     // [] when no provider is ready (no key, Expo Go): show "coming soon", never made-up prices
const result = await payments.buy(plans[0]);  // { ok: true, tier } | { ok: false, cancelled, pending?, message }
await payments.restore();
await payments.openManage(() => showLoader()); // the store's manage sheet (inside the app on iPhone); the callback runs when it closes
```

On sign-out call `payments.stop()`, so the next person on the phone never buys on the last person's account.

## `createPaymentsKit` options

| Option | Notes |
|---|---|
| `providers` | `{ ios?, android?, web?, default? }`: one `PaymentProvider` per platform |
| `tiers` | Lowest first, starting with `free` |
| `backend` | Optional `SubscriptionBackend`, such as `supabaseBackend(supabase)` |
| `tester` | `true` turns on the tester switch. Pass `__DEV__` |
| `testerStorage` | Where the tester tier is kept (AsyncStorage fits) |
| `storage` | Where each account's last known tier is kept, for launches when the store can't be reached (AsyncStorage fits). Default: `testerStorage` |
| `onOnline` | `(cb) => unsubscribe`: calls `cb` when the device is back online, so a failed store check is tried again at once |
| `messages` | Reword the store messages (`DEFAULT_MESSAGES`) |
| `onError` | `(where, error)`, for crash reporting |

## The kit's API

| Member | What it does |
|---|---|
| `start(userId)`, `stop()` | Link or unlink the signed-in account |
| `watch(userId, cb)` | The account's tier, live. Waits for the store's first answer (at most 5 s) so a paid account never flashes "free"; offline it reports the last known tier and keeps trying. `undefined` while the session is still loading. Returns an unsubscribe |
| `loadPlans()` | Store plans with prices in the buyer's currency, and a trial only when the person can still use it (`trial`: its period as the store sets it, such as MONTH × 1) |
| `buy(plan)`, `restore()` | Purchases, with friendly store errors |
| `redeemCode(code?)`, `canRedeemCode` | Offer codes (not on the web) |
| `openManage(onClosed?)` | Apple's manage sheet inside the app on iPhone; the store's page elsewhere. Then checks again until auto-renew or the plan changes |
| `manageUrl()` | The store's manage page address |
| `refresh(before?)` | Ask the store again and update every `watch()` |
| `loadOffer(id)`, `buyOffer(offer)` | App Store promotional offers for people who already subscribe (RevenueCat signs them with the In-App Purchase key) |
| `testerAvailable`, `getTesterTier()`, `setTesterTier(tier)` | The development tester switch |
| `readServer(userId?)` | The server row, when there is a backend |

## Tiers and plans

- **Tiers** are levels of access, lowest first, always starting with `free`. A higher tier includes everything below it. In RevenueCat, make one entitlement per paid tier with the same name (or map them with `entitlements: { pro: 'pro_access' }`).
- **Plans** are ways to pay for a tier (monthly, yearly). One app can sell one plan, another six. Each plan names its tier and its RevenueCat package type (`ANNUAL`, `MONTHLY`) or package identifier.

## Payment vendors

| Provider | Sells on | Money goes through |
|---|---|---|
| `revenueCatMobile` | iPhone and Android apps | App Store and Google Play |
| `revenueCatWeb` | Website | Your Stripe (or Paddle) account |

Inside an iPhone or Android app, digital subscriptions normally must use Apple's or Google's billing; card checkout fits the website.

A vendor is a `PaymentProvider` (see `src/core/types.ts`). Adding one (Stripe without RevenueCat, Paddle, Razorpay) is one folder in `src/providers` plus one file in the webhook. Step by step in [docs/providers.md](docs/providers.md), which also maps every folder in this repo.

## Failures

Apple, Google and Stripe hold the money: the kit never charges or refunds. A cancelled or declined purchase changes nothing. A purchase charged while the app crashed is finished by the store on the next start, and the webhook unlocks it on the server anyway. A failed renewal keeps access during the store's grace period (`status: 'grace'`). A refund ends access when the webhook hears about it. If the webhook's database write fails it answers with an error so the provider retries; repeated and out-of-order events are skipped.

## Setup guides

- Phones (store products, RevenueCat, the SQL and the webhook): [docs/setup.md](docs/setup.md)
- Website (Stripe and RevenueCat Web Billing): [docs/revenuecat-web.md](docs/revenuecat-web.md)
- New vendors and the folder map: [docs/providers.md](docs/providers.md)

## Testing

`npm test` runs the unit tests (tiers, the RevenueCat provider against a fake store, `watch`, the tester switch, webhook event handling). In an app, the tester switch works on the web and in Expo Go; real sandbox purchases need a development build.

```bash
npm install
npm run typecheck
npm test
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md), which also has the upgrade note from 1.x.

## Writing rule

Every word this kit shows, and every line of its documentation, follows the shared [Writing rule](https://github.com/yuvarajsalla20/app-settings-kit#writing-rule-every-word-is-professional): Title Case for titles, rows and buttons; calm, complete sentences for captions and messages; "e.g.," for examples; no chatty fragments, slang or exclamation marks. Apps do not override these words; a change is made in the kit so that every app receives it.

## License

MIT
