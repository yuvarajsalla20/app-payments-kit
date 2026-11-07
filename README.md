# app-payments-kit

Reusable payments for React Native / Expo apps (iOS, Android, web).
One API over the App Store and Google Play, any number of tiers and plans, a server webhook and `subscriptions` table so the database knows who paid, and a developer-only switch to try paid features without buying.

It has no screens. For the Plans screen, locks and `canUse()`, add [app-subscriptions-kit](https://github.com/yuvarajsalla20/app-subscriptions-kit) on top.

## What you get

| Piece | What it does |
|---|---|
| `createPaymentsKit({ providers, tiers, backend, tester })` | `start`/`stop` (link the signed-in account), `loadPlans`, `buy`, `restore`, `redeemCode`, `manageUrl`/`openManage`, `watch` (the account's tier, live), `setTesterTier` |
| `revenueCat({ iosKey, androidKey, plans })` from `app-payments-kit/revenuecat` | The App Store and Google Play provider, through RevenueCat. Store prices in the buyer's currency, trial only when the person can still use it, friendly store errors |
| `supabaseBackend(supabase)` from `app-payments-kit/supabase` | Reads the account's own `subscriptions` row, so a purchase made on another phone, or a tester grant, counts |
| `supabase/sql/subscriptions.sql` | Tables `tiers`, `subscriptions`, `subscription_events`; checks `current_tier(uid)`, `has_tier(uid, tier)`, `is_premium(uid)` for your own database rules; row-level security |
| `supabase/functions/payments-webhook` | Edge Function the provider calls on every buy, renewal, cancel, refund and transfer. Checks a secret, skips repeats and late events, writes the row |

## Use it

```ts
// payments.ts  (one per app)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from 'app-core-kit';
import { createPaymentsKit } from 'app-payments-kit';
import { revenueCat } from 'app-payments-kit/revenuecat';
import { supabaseBackend } from 'app-payments-kit/supabase';
import { supabase } from './supabase';

const tiers = ['free', 'premium'];  // or ['free', 'plus', 'pro']

export const payments = createPaymentsKit({
  tiers,
  providers: {
    default: revenueCat({
      iosKey: process.env.EXPO_PUBLIC_RC_IOS_KEY,
      androidKey: process.env.EXPO_PUBLIC_RC_ANDROID_KEY,
      tiers,
      plans: [                                     // shown in this order
        { id: 'yearly', tier: 'premium', package: 'ANNUAL' },
        { id: 'monthly', tier: 'premium', package: 'MONTHLY' },
      ],
    }),
  },
  backend: supabaseBackend(supabase),
  tester: __DEV__,                                 // "pretend tier" switch, never in store builds
  testerStorage: AsyncStorage,
  onError: reportError,
});
```

```ts
// Anywhere
const stop = payments.watch(userId, ({ tier, source }) => setTier(tier));  // 'free' | 'premium' …; source: store, account, tester
const plans = await payments.loadPlans();     // [] on web / Expo Go without a store: show "purchases open soon", never made-up prices
const result = await payments.buy(plans[0]);  // { ok: true, tier } | { ok: false, cancelled, pending?, message }
await payments.restore();
await payments.openManage();                  // the store's own "manage subscription" page
```

On sign-out call `payments.stop()`, so the next person on the phone never buys on the last person's account.

## Tiers and plans

- **Tiers** are levels of access, lowest first, always starting with `free`. A higher tier includes everything below it. In RevenueCat, make one entitlement per paid tier with the same name (or map them with `entitlements: { pro: 'pro_access' }`).
- **Plans** are ways to pay for a tier (monthly, yearly …). One app can sell 1 plan, another 6. Each plan names its tier and the RevenueCat package type or package identifier.

## Other payment vendors

A vendor is a `PaymentProvider` (see `src/types.ts`): `start`, `loadPlans`, `buy`, `restore`, `currentTier`, `onTierChange`, and optional `redeemCode` and `manageUrl`. Pass one per platform: `providers: { ios, android, web }`. On the server, add a function to `PROVIDERS` in `supabase/functions/payments-webhook/index.ts` that turns the vendor's event into a `Change`, and the rest stays the same.

Inside an iPhone or Android app, digital subscriptions normally must use Apple's or Google's own billing; card vendors such as Stripe fit the website.

## Failures

Apple and Google hold the money: the kit never charges or refunds. A cancelled or declined purchase changes nothing. A purchase charged while the app crashed is finished by the store on the next start, and the webhook unlocks it on the server anyway. A failed renewal keeps access during the store's grace period (`status: 'grace'`). A refund ends access when the webhook hears about it. If the webhook's database write fails it answers with an error so the provider retries; repeated and out-of-order events are skipped.

## Setup

Store products, RevenueCat, the SQL and the webhook: [docs/setup.md](docs/setup.md).

## Testing

`npm test` runs the unit tests (tiers, the RevenueCat provider against a fake store, `watch`, the tester switch, webhook event handling). In an app, the tester switch works on the web and in Expo Go; real sandbox purchases need a development build.

## License

MIT
