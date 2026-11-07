-- Undo subscriptions.sql. Deletes every subscription row and event log: export them first if you need them.
drop function if exists public.my_tier();
drop function if exists public.is_premium(uuid);
drop function if exists public.has_tier(uuid, text);
drop function if exists public.current_tier(uuid);
drop table if exists public.subscription_events;
drop table if exists public.subscriptions;
drop table if exists public.tiers;
