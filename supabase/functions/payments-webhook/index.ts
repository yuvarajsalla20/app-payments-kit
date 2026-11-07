// app-payments-kit webhook: keeps public.subscriptions in step with the payment provider.
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

import { createClient } from 'npm:@supabase/supabase-js@2';
import { plan, sameSecret, type Change, type StoredRow } from './core.ts';
import { fromRevenueCat, type RcEvent } from './revenuecat.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tiers = (env('PAYMENTS_TIERS') || 'free,premium').split(',').map((t) => t.trim()).filter(Boolean);

/** One entry per provider: turns its request body into a Change (or null for "nothing to do"). Add Stripe and others here. */
const PROVIDERS: Record<string, (body: unknown, now: Date) => Change | null> = {
  revenuecat: (body, now) => fromRevenueCat((body as { event: RcEvent }).event, tiers, now),
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = env('PAYMENTS_WEBHOOK_SECRET');
  if (!secret || !sameSecret(`Bearer ${secret}`, req.headers.get('authorization') ?? '')) return json({ error: 'unauthorized' }, 401);

  const name = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
  const toChange = PROVIDERS[name] ?? PROVIDERS.revenuecat!;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const now = new Date();
  const change = toChange(body, now);
  if (!change) return json({ ok: true, skipped: 'nothing to change' });

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  // A repeated delivery of an event already applied is skipped.
  const { data: seen, error: seenErr } = await db.from('subscription_events').select('id').eq('id', change.eventId).maybeSingle();
  if (seenErr) return json({ error: seenErr.message }, 500);
  if (seen) return json({ ok: true, skipped: 'duplicate' });

  const ids = change.transfer ? [...change.transfer.from, ...change.transfer.to] : change.userIds;
  const { data: stored, error: readErr } = await db.from('subscriptions').select('user_id,tier,active_until,will_renew,event_at').in('user_id', ids);
  if (readErr) return json({ error: readErr.message }, 500);
  const rows = plan(change, (stored ?? []) as StoredRow[], now);

  // One row at a time, so an id with no account (foreign key) is skipped instead of failing the rest.
  let updated = 0;
  for (const row of rows) {
    const { error } = await db.from('subscriptions').upsert(row);
    if (!error) updated++;
    else if (error.code !== '23503') return json({ error: error.message }, 500); // provider retries later
  }

  // Logged after the rows are written, so a failed write is retried rather than skipped as a duplicate.
  const { error: logErr } = await db.from('subscription_events').insert({ id: change.eventId, user_id: rows[0]?.user_id ?? null, provider: change.provider, type: change.type, payload: body });
  if (logErr && logErr.code !== '23505') console.error('payments-webhook: could not log event', logErr.message);
  return json({ ok: true, updated });
});
