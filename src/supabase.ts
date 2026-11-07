import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServerSubscription, SubscriptionBackend, SubscriptionStatus } from './types';

export interface SupabaseBackendOptions {
  /** Default 'subscriptions' (made by supabase/sql/subscriptions.sql). */
  table?: string;
}

/** Reads the signed-in account's own row. Row-level security lets an account read only its own row and never write it. */
export function supabaseBackend(client: SupabaseClient | null | undefined, options: SupabaseBackendOptions = {}): SubscriptionBackend {
  const table = options.table ?? 'subscriptions';
  return {
    async read(userId) {
      if (!client) return null;
      const { data, error } = await client
        .from(table)
        .select('tier,active_until,status,will_renew,provider,product_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as Record<string, unknown>;
      const out: ServerSubscription = {
        tier: String(row.tier ?? 'free'),
        activeUntil: (row.active_until as string | null) ?? null,
        status: (row.status as SubscriptionStatus | null) ?? null,
        willRenew: (row.will_renew as boolean | null) ?? null,
        provider: (row.provider as string | null) ?? null,
        productId: (row.product_id as string | null) ?? null,
      };
      return out;
    },
  };
}
