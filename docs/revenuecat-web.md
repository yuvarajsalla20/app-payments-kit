# Selling on the website (RevenueCat Web Billing)

`revenueCatWeb` sells the same tiers on your website. RevenueCat shows its own card checkout and sends the money
through **your own Stripe account** (Paddle also works). RevenueCat keeps one customer per signed-in account, so a
parent who pays on the web has the tier on their phone too, and a phone purchase counts on the web.

```
Website ── revenueCatWeb ──► RevenueCat Web Billing ──► Stripe (charges the card, pays your bank)
                                     │
iPhone / Android ── revenueCatMobile ──► RevenueCat ──► App Store / Google Play
                                     │
                                     ▼
                   one customer, one entitlement ──► the same payments-webhook ──► subscriptions row
```

Never paste keys into chat or code. Put them straight into the places named below.

## 1. Stripe

1. Create a Stripe account (or use yours) and finish the business and bank details, so payouts work.
2. Optional but recommended: turn on **Stripe Tax**, so sales tax and VAT are added for each country.
   App Store and Google Play handle tax for you; on the web it is your job.

## 2. RevenueCat

The dashboard wording changes from time to time; RevenueCat's own "Web Billing" guide has the current steps.

1. In your RevenueCat project, add a **Web Billing** app and connect your Stripe account to it.
   Fill in the app name, support email and the look of the checkout.
2. **Products:** create one Web Billing product per plan, with the same lengths and prices as the stores
   (a free trial is set on the product).
3. **Entitlements:** attach each web product to the same entitlement as its phone product (`premium`, or `plus` and `pro`).
4. **Offerings:** add the web products to the same packages in the `default` offering (`ANNUAL`, `MONTHLY` …).
   The kit then finds them with the same `plans` list as on the phone.
5. **API key:** copy the Web Billing public key (starts with `rcb_`; a sandbox key starts with `rcb_sb_` and only takes
   Stripe test cards). Put it in the website's environment, for example `EXPO_PUBLIC_RC_WEB_KEY`.

The webhook you already set up for the phones also receives web purchases (their `store` is `RC_BILLING`).
Nothing changes on the server.

## 3. The app

```ts
import { revenueCatWeb } from 'app-payments-kit/revenuecat-web';

const web = revenueCatWeb({
  apiKey: process.env.EXPO_PUBLIC_RC_WEB_KEY,
  tiers,
  plans,                                     // the same list you give revenueCatMobile
  customerEmail: () => currentUser?.email,  // optional: checkout won't ask again
});

createPaymentsKit({ tiers, providers: { ios: mobile, android: mobile, web }, backend, ... });
```

Import it only in the website build, so phones never download the web SDK. In Expo, put it in a `.web.ts` file:

```
src/lib/webPayments.web.ts   → export const webProvider = revenueCatWeb({ ... })
src/lib/webPayments.ts       → export const webProvider = undefined
```

Good to know:

- The person must be **signed in** to buy on the web. Purchases belong to the account, so "Restore" just reads it again.
- There is **no code box** on the web (App Store and Google Play codes only work in their stores).
  `payments.canRedeemCode` is false, and app-subscriptions-kit hides "Have a code?".
- **Manage subscription** opens RevenueCat's page for web purchases, or the App Store / Google Play page when the
  person bought on a phone.
- Apple and Google don't allow an iPhone or Android app to send people to a web checkout for digital subscriptions in
  most countries, so don't link from the app to the website's Plans page.

## 4. Test

1. Use the sandbox key (`rcb_sb_…`) and run the website locally (`npx expo start --web`).
2. Sign in, open Plans, buy with Stripe's test card `4242 4242 4242 4242`, any future date and any CVC.
3. Check: the tier turns on, the webhook writes the row (`provider = 'revenuecat'`, `store = 'RC_BILLING'`),
   the phone shows the tier after sign-in, and Manage opens the web subscription page.
