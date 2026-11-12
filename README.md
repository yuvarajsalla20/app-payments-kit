# app-payments-kit

Reusable payments for React Native / Expo apps (iOS, Android, web).
One API over the App Store, Google Play and the website, any number of tiers and plans, a server webhook and `subscriptions` table so the database knows who paid, and a developer-only switch to try paid features without buying.

It has no screens. For the Plans screen, locks and `canUse()`, add [app-subscriptions-kit](https://github.com/yuvarajsalla20/app-subscriptions-kit) on top.

## What you get

| Piece | What it does |
|---|---|
| `createPaymentsKit({ providers, tiers, backend, tester })` | `start`/`stop` (link the signed-in account), `loadPlans`, `buy`, `restore`, `redeemCode`, `manageUrl`/`openManage`, `watch` (the account's tier, live), `setTesterTier` |
| `revenueCatMobile({ iosKey, androidKey, plans })` from `app-payments-kit/revenuecat-mobile` | **RevenueCat mobile**: the App Store and Google Play. Store prices in the buyer's currency, trial only when the person can still use it, friendly store errors |
| `revenueCatWeb({ apiKey, plans })` from `app-payments-kit/revenuecat-web` | **RevenueCat web**: card checkout on the website through RevenueCat Web Billing and your Stripe account. Same tiers and plans as the phones, one subscription across all devices |
| `supabaseBackend(supabase)` from `app-payments-kit/supabase` | Reads the account's own `subscriptions` row, so a purchase made on another phone, or a tester grant, counts |
| `supabase/sql/subscriptions.sql` | Tables `tiers`, `subscriptions`, `subscription_events`; checks `current_tier(uid)`, `has_tier(uid, tier)`, `is_premium(uid)` for your own database rules; row-level security |
| `supabase/functions/payments-webhook` | Edge Function the provider calls on every buy, renewal, cancel, refund and transfer. Checks a secret, skips repeats and late events, writes the row |

## Use it

```ts
// payments.ts  (one per app)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from 'app-core-kit';
import { createPaymentsKit } from 'app-payments-kit';
import { revenueCatMobile } from 'app-payments-kit/revenuecat-mobile';
import { supabaseBackend } from 'app-payments-kit/supabase';
import { supabase } from './supabase';
import { webProvider } from './webPayments';   // revenueCatWeb in webPayments.web.ts, undefined on phones

const tiers = ['free', 'premium'];  // or ['free', 'plus', 'pro']
const plans = [                     // shown in this order, the same on phone and web
  { id: 'yearly', tier: 'premium', package: 'ANNUAL' },
  { id: 'monthly', tier: 'premium', package: 'MONTHLY' },
];
const mobile = revenueCatMobile({
  iosKey: process.env.EXPO_PUBLIC_RC_IOS_KEY,
  androidKey: process.env.EXPO_PUBLIC_RC_ANDROID_KEY,
  tiers,
  plans,
});

export const payments = createPaymentsKit({
  tiers,
  providers: { ios: mobile, android: mobile, web: webProvider },
  backend: supabaseBackend(supabase),
  tester: __DEV__,                                 // "pretend tier" switch, never in store builds
  testerStorage: AsyncStorage,
  onError: reportError,
});
```

```ts
// Anywhere
const stop = payments.watch(userId, ({ tier, source, renewal }) => setTier(tier));  // 'free' | 'premium' …; source: store, account, tester
// renewal: { until, willRenew, productId } from the store while it gives the tier, so an app without a server can show "Ends Nov 12"
const plans = await payments.loadPlans();     // [] where no provider is ready (no key, Expo Go): show "purchases open soon", never made-up prices
const result = await payments.buy(plans[0]);  // { ok: true, tier } | { ok: false, cancelled, pending?, message }
await payments.restore();
await payments.openManage();                  // the store's own "manage subscription" screen (in the app on iPhone)
```

On sign-out call `payments.stop()`, so the next person on the phone never buys on the last person's account.

## Tiers and plans

- **Tiers** are levels of access, lowest first, always starting with `free`. A higher tier includes everything below it. In RevenueCat, make one entitlement per paid tier with the same name (or map them with `entitlements: { pro: 'pro_access' }`).
- **Plans** are ways to pay for a tier (monthly, yearly …). One app can sell 1 plan, another 6. Each plan names its tier and the RevenueCat package type or package identifier.

## Payment vendors (providers)

| Provider | Sells on | Money goes through |
|---|---|---|
| RevenueCat mobile (`revenueCatMobile`) | iPhone and Android apps | App Store and Google Play |
| RevenueCat web (`revenueCatWeb`) | Website | Your Stripe (or Paddle) account |

Inside an iPhone or Android app, digital subscriptions normally must use Apple's or Google's own billing; card checkout fits the website.

A vendor is a `PaymentProvider` (see `src/core/types.ts`). Adding one (Stripe without RevenueCat, Paddle, Razorpay …) is one folder in `src/providers` plus one file in the webhook: step by step in [docs/providers.md](docs/providers.md), which also maps every folder in this repo.

## Failures

Apple, Google and Stripe hold the money: the kit never charges or refunds. A cancelled or declined purchase changes nothing. A purchase charged while the app crashed is finished by the store on the next start, and the webhook unlocks it on the server anyway. A failed renewal keeps access during the store's grace period (`status: 'grace'`). A refund ends access when the webhook hears about it. If the webhook's database write fails it answers with an error so the provider retries; repeated and out-of-order events are skipped.

## Setup

- Phones (store products, RevenueCat, the SQL and the webhook): [docs/setup.md](docs/setup.md)
- Website (Stripe and RevenueCat Web Billing): [docs/revenuecat-web.md](docs/revenuecat-web.md)
- New vendors and the folder map: [docs/providers.md](docs/providers.md)

## Changelog

- **2.3.2**: the sync after Apple's manage sheet first makes sure the store is on the signed-in person, like buy and restore (`openManage(userId)` on providers). A newer `refresh()` replaces the later checks of an older one, so repeated calls no longer pile up timers.
- **2.3.1**: after Apple's in-app manage sheet closes, RevenueCat mobile sends this phone's purchases to RevenueCat (`syncPurchasesForResult`), so a cancel or renew shows at once even when Apple's server notification is slow or not set up. `refresh()` now looks again at 4, 15 and 45 seconds.
- **2.3.0**: `refresh()` asks the store again (not its saved copy) and updates every `watch()`, then looks twice more over the next 15 seconds. `openManage()` calls it when Apple's in-app sheet closes, so a cancel or renew shows at once. `loadOffer(id)` / `buyOffer(offer)` sell an App Store promotional offer to people who already subscribe (RevenueCat signs it with the In-App Purchase key uploaded to it); `loadOffer` is null where there is none. Providers can add `refresh?()`, `loadOffer?()` and `buyOffer?()`.
- **2.2.0**: `watch()` states carry `renewal` (`until`, `willRenew`, `productId`) from the store's entitlement while the tier comes from the store. Providers can add `renewal?()`; both RevenueCat providers do.
- **2.1.0**: `openManage()` on iPhone shows Apple's manage sheet inside the app (RevenueCat `showManageSubscriptions`), which also lists TestFlight and sandbox subscriptions. Android, the website, and any failure still open the store's manage page. Providers can add `openManage?()`.
- **2.0.1**: `watch()` waits for the account's row before its first answer.

## Upgrading from 1.x

`revenueCat` from `app-payments-kit/revenuecat` is now `revenueCatMobile` from `app-payments-kit/revenuecat-mobile`; its options are the same. Nothing else changed for apps.

## Testing

`npm test` runs the unit tests (tiers, the RevenueCat provider against a fake store, `watch`, the tester switch, webhook event handling). In an app, the tester switch works on the web and in Expo Go; real sandbox purchases need a development build.

## License

MIT
