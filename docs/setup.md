# Setting up payments

This page sets up the iPhone and Android apps (`revenueCatMobile`). For the website, follow it first, then
[revenuecat-web.md](revenuecat-web.md). Other vendors: [providers.md](providers.md).

Never paste keys or passwords into chat or code. Put them straight into the places named below.

## 1. Store products

Create the same products in both stores, in one subscription group per tier.

- **App Store Connect:** sign the Paid Apps agreement and add banking and tax details. Then go to the app → Subscriptions, create the group and one product per plan. A free trial is an introductory offer on a product.
- **Google Play Console:** set up a payments profile. Then go to the app → Monetize → Subscriptions, create one subscription with a base plan per length. A free trial is an offer on a base plan. Google only lets you create products after a build with the billing permission has been uploaded (an internal-testing upload is enough).

Tip: put a free trial on the longest plan only, so people can't take a free week just before they need the app.

## 2. RevenueCat

1. Create a project and add an App Store app and a Play Store app. Follow RevenueCat's steps to connect each store.
2. **Entitlements:** one per paid tier, named exactly like the tier (`premium`, or `plus` and `pro`). Attach each product to its tier's entitlement.
3. **Offerings:** make the `default` offering current, with one package per plan. The kit finds plans by package type (`ANNUAL`, `SIX_MONTH`, `THREE_MONTH`, `MONTHLY`, `WEEKLY`, `LIFETIME`) or by a custom package identifier.
4. **API keys:** copy the two public SDK keys (iOS starts with `appl_`, Android with `goog_`). Put them in your build's environment variables, for example `EXPO_PUBLIC_RC_IOS_KEY` and `EXPO_PUBLIC_RC_ANDROID_KEY`.

`react-native-purchases` needs a development or store build. Wherever no provider is ready (no key, Expo Go), `payments.ready` is false and `loadPlans()` returns nothing. To sell on the website too, add `revenueCatWeb` ([revenuecat-web.md](revenuecat-web.md)).

## 3. The database (Supabase)

1. Edit the `insert into public.tiers` line in `supabase/sql/subscriptions.sql` to list your tiers with their order.
2. Run the file in the Supabase SQL Editor. It is safe to run again. `subscriptions.down.sql` undoes it.
3. Use `public.has_tier(user_id, 'premium')` in your own triggers and policies for limits that matter (the file ends with an example).

The app can read only its own row and can't change it. Only the webhook writes it.

## 4. The webhook

1. Copy `supabase/functions/payments-webhook` into your app's `supabase/functions` folder.
2. In Supabase → Edge Functions → Secrets, add `PAYMENTS_WEBHOOK_SECRET` (a long random string) and, if you have more than one paid tier, `PAYMENTS_TIERS` (for example `free,plus,pro`).
3. Deploy: `npx supabase functions deploy payments-webhook --project-ref <ref> --no-verify-jwt`
4. In RevenueCat → Integrations → Webhooks, add `https://<ref>.supabase.co/functions/v1/payments-webhook/revenuecat` with the Authorization header `Bearer <the same secret>`, then press "Send test event". It should answer `ok`.

## 5. Tester access without buying

For TestFlight and internal testers, grant a tier in the SQL Editor (with the tester's sign-in email):

```sql
insert into public.subscriptions (user_id, tier, active_until, status, provider, store, product_id)
select id, 'premium', now() + interval '1 year', 'active', 'manual', 'manual', 'tester' from auth.users where email = 'you@example.com'
on conflict (user_id) do update set tier = excluded.tier, active_until = excluded.active_until, status = 'active', provider = 'manual', product_id = 'tester', updated_at = now();
```

Take it away: `update public.subscriptions set active_until = now() where user_id = (select id from auth.users where email = 'you@example.com');`

In development builds and Expo Go, `payments.setTesterTier('premium')` turns a tier on for that phone only. It never reaches the server, so database limits still follow the real tier.

## 6. Test before release

- iPhone: Settings → App Store → Sandbox Account, then buy in a development build. Sandbox years last about an hour.
- Android: add your Gmail as a licence tester in Play Console → Settings → License testing, and install from the internal test track or a local build.
- Check: buy, restore on a second phone, cancel (access stays until the end date), a failed renewal (grace), a refund, and offer codes.
