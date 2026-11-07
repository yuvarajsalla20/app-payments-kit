-- app-payments-kit: subscriptions on Supabase.
-- Run once in the Supabase SQL Editor. Safe to run again.
-- Then deploy supabase/functions/payments-webhook (see docs/setup.md).

-- 1. Your tiers, lowest first. Edit the insert to match the app's config, e.g. ('plus', 1), ('pro', 2).
create table if not exists public.tiers (
  name text primary key,
  rank int not null unique
);
insert into public.tiers (name, rank) values ('free', 0), ('premium', 1)
  on conflict (name) do nothing;
alter table public.tiers enable row level security;
drop policy if exists "anyone reads tiers" on public.tiers;
create policy "anyone reads tiers" on public.tiers for select using (true);
revoke insert, update, delete on public.tiers from anon, authenticated;

-- 2. One row per account. Only the webhook (service role) writes it.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier text not null default 'free',
  active_until timestamptz,
  status text check (status in ('active', 'trial', 'grace', 'cancelled', 'expired', 'refunded', 'pending')),
  will_renew boolean,
  provider text,
  store text,
  product_id text,
  environment text,
  event_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription" on public.subscriptions for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.subscriptions from anon, authenticated;

-- 3. Every webhook event, so a repeated delivery is skipped and support can see what happened.
create table if not exists public.subscription_events (
  id text primary key,
  user_id uuid,
  provider text not null,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
create index if not exists subscription_events_user on public.subscription_events (user_id, received_at desc);
alter table public.subscription_events enable row level security;
revoke all on public.subscription_events from anon, authenticated;

-- 4. Checks for your own rules and triggers. Not callable from the app (they take any user id).
create or replace function public.current_tier(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.tier from public.subscriptions s where s.user_id = uid and s.active_until > now()),
    'free');
$$;

create or replace function public.has_tier(uid uuid, wanted text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select have.rank >= need.rank
       from public.tiers have, public.tiers need
      where have.name = public.current_tier(uid) and need.name = wanted),
    false);
$$;

-- Shortcut for apps with one paid tier.
create or replace function public.is_premium(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_tier(uid) <> 'free';
$$;

revoke execute on function public.current_tier(uuid) from public, anon, authenticated;
revoke execute on function public.has_tier(uuid, text) from public, anon, authenticated;
revoke execute on function public.is_premium(uuid) from public, anon, authenticated;

-- 5. Your own tier for the app, read through the signed-in session only.
create or replace function public.my_tier() returns text
language sql stable security definer set search_path = public as $$
  select public.current_tier(auth.uid());
$$;
revoke execute on function public.my_tier() from public, anon;
grant execute on function public.my_tier() to authenticated;

-- Example: limit children per family by tier (adapt to your own table).
-- create or replace function public.check_child_limit() returns trigger language plpgsql security definer as $$
-- begin
--   if (select count(*) from public.children where parent_id = new.parent_id) >= case when public.has_tier(new.parent_id, 'premium') then 4 else 2 end
--   then raise exception 'child limit reached'; end if;
--   return new;
-- end $$;
