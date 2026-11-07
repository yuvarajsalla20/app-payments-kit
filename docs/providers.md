# Providers: the payment vendors

A **provider** connects the kit to one payment vendor. The kit core never imports a vendor, so an app only bundles the
providers it uses, and a new vendor is one new folder.

## The ones in the kit

| Provider | Import | Where it sells | Money goes through |
|---|---|---|---|
| `revenueCatMobile` | `app-payments-kit/revenuecat-mobile` | iPhone and Android apps | App Store and Google Play |
| `revenueCatWeb` | `app-payments-kit/revenuecat-web` | Website | Your Stripe (or Paddle) account, through RevenueCat Web Billing |

Both use the same RevenueCat project, the same entitlements and the same `plans` list, so one tier covers every
device. Setup: [setup.md](setup.md) for the phones and [revenuecat-web.md](revenuecat-web.md) for the website.

Pick one per platform:

```ts
createPaymentsKit({ providers: { ios: mobile, android: mobile, web }, ... });
```

`default` is used for any platform you don't name.

## Where things are

```
app-payments-kit/
  revenuecat-mobile.ts   revenuecat-web.ts   supabase.ts      ← entry points (one per vendor or backend)
  src/
    index.ts                                                   ← `app-payments-kit`: the core only
    core/        createPaymentsKit, types (Plan, PaymentProvider …), tiers, messages
    providers/
      revenuecat/
        shared.ts   plan matching, periods, tier from entitlements (used by both)
        mobile.ts   revenueCatMobile (react-native-purchases)
        web.ts      revenueCatWeb    (@revenuecat/purchases-js)
    backends/
      supabase.ts   supabaseBackend: reads the account's subscriptions row
  supabase/
    sql/                      the tables and checks
    functions/payments-webhook/
      core.ts                 vendor-free: order, repeats, transfers, writing the row
      revenuecat.ts           RevenueCat event → Change
      index.ts                the Edge Function, with the PROVIDERS list
  tests/                      one test file per piece, with stand-ins for the vendor SDKs in tests/stubs
```

## Adding a new vendor

Say you add Paddle without RevenueCat. Use the name everywhere: folder `paddle`, function `paddle…`, entry
`app-payments-kit/paddle-web`.

### 1. The app side

1. Make `src/providers/paddle/web.ts` exporting `paddleWeb(options): PaymentProvider`. The interface is in
   `src/core/types.ts`:

   | Method | What it must do |
   |---|---|
   | `name`, `ready` | A short name for logs; `ready` false when it can't sell here (no key, wrong platform) |
   | `start(userId)` | Tie the vendor's customer to the signed-in account; `null` on sign-out |
   | `loadPlans()` | The vendor's real prices as `Plan`s, in the app's order. Never made-up prices |
   | `buy(plan, userId)` | Run checkout for **this** account only; return `{ ok: true, tier }` or a friendly failure |
   | `restore(userId)` | Look again at what this account owns |
   | `currentTier()`, `onTierChange(cb)` | The highest tier the vendor says the account has, and changes to it |
   | `redeemCode?`, `manageUrl?` | Optional: leave out what the vendor doesn't have |

   Turn the vendor's errors into a `BuyResult` with the shared `PaymentMessages`, and treat "the person closed
   checkout" as `cancelled: true` with no message.
2. Add the entry file `paddle-web.ts` at the root (`export * from './src/providers/paddle/web';`), list it in
   `package.json` `files`, and add the vendor SDK as an optional peer dependency.
3. Add `tests/stubs/paddle.ts` (a fake SDK), point the alias to it in `vitest.config.ts`, and write
   `tests/paddle-web.test.ts`, copying the cases in `tests/revenuecat-web.test.ts`.

### 2. The server side

1. Make `supabase/functions/payments-webhook/paddle.ts` exporting `fromPaddle(event, tiers, now): Change | null`.
   Return null for events that change nothing. Look at `revenuecat.ts` for buy, renewal, cancel, refund and expiry.
2. Add it to `PROVIDERS` in `index.ts`. The vendor then calls `…/functions/v1/payments-webhook/paddle`. The function
   checks `PAYMENTS_WEBHOOK_SECRET`; if the vendor signs its webhooks instead, check that signature too.
3. Add its cases to `tests/webhook.test.ts`.

`core.ts` does the rest the same way for every vendor: skipping repeats and late events, transfers and writing the row.

### 3. Docs

Add a row to the table at the top of this page and a `docs/<vendor>.md` with the setup steps.
