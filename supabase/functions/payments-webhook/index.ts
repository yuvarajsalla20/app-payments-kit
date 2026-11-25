// app-payments-kit webhook for Supabase: keeps public.subscriptions in step with the payment provider.
//
// Copy this folder to your app's supabase/functions/payments-webhook, then deploy:
//   supabase functions deploy payments-webhook --no-verify-jwt
// (the provider sends no Supabase token; the shared secret protects it instead).
//
// Secrets (Supabase → Edge Functions → Secrets):
//   PAYMENTS_WEBHOOK_SECRET  any long random string; the provider sends it as "Authorization: Bearer <secret>"
//   PAYMENTS_TIERS           optional, tiers lowest first, default "free,premium"
//
// RevenueCat → Project → Integrations → Webhooks:
//   URL: https://<project-ref>.supabase.co/functions/v1/payments-webhook/revenuecat
//   Authorization header: Bearer <PAYMENTS_WEBHOOK_SECRET>
//
// The app signs in to the provider with the account's Supabase user id, so the event's user id is that id.
// The webhook logic is the kit's shared server code (server/), the same for every backend; this file only connects it to
// Supabase. Keep the version below equal to the kit version the app pins.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseTiers, paymentsWebhook, supabaseStore } from 'https://cdn.jsdelivr.net/gh/yuvarajsalla20/app-payments-kit@v2.11.0/server.mjs';

const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(
  paymentsWebhook({
    secret: env('PAYMENTS_WEBHOOK_SECRET'),
    tiers: parseTiers(env('PAYMENTS_TIERS')),
    store: supabaseStore(createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })),
  }),
);
