// The webhook's store for Supabase: the tables made by supabase/sql/subscriptions.sql.
import { isUuid } from '../core.mjs';

/** @typedef {import('../handler.mjs').SubscriptionStore} SubscriptionStore */

/**
 * @typedef {object} SupabaseStoreOptions
 * @property {string} [table] Default 'subscriptions'.
 * @property {string} [events] Default 'subscription_events'.
 */

/**
 * Writes with a service-role client (`createClient(url, serviceRoleKey)`), which row-level security lets write the rows.
 * Account ids are Supabase user ids (UUIDs); an id with no account (foreign key) is skipped.
 * @param {any} client A `SupabaseClient` with the service role.
 * @param {SupabaseStoreOptions} [options]
 * @returns {SubscriptionStore}
 */
export function supabaseStore(client, options = {}) {
  const table = options.table ?? 'subscriptions';
  const events = options.events ?? 'subscription_events';
  /** @param {{ message: string } | null} error */
  const fail = (error) => {
    if (error) throw new Error(error.message);
  };
  return {
    isAccountId: isUuid,
    async hasEvent(id) {
      const { data, error } = await client.from(events).select('id').eq('id', id).maybeSingle();
      fail(error);
      return !!data;
    },
    async readRows(ids) {
      if (!ids.length) return [];
      const { data, error } = await client.from(table).select('user_id,tier,active_until,will_renew,event_at').in('user_id', ids);
      fail(error);
      return data ?? [];
    },
    async writeRow(row) {
      const { error } = await client.from(table).upsert(row);
      if (!error) return 'written';
      if (error.code === '23503') return 'no-account';
      throw new Error(error.message);
    },
    async logEvent(event) {
      const { error } = await client.from(events).insert({ id: event.id, user_id: event.userId, provider: event.provider, type: event.type, payload: event.payload });
      // 23505: already logged by an earlier delivery.
      if (error && error.code !== '23505') throw new Error(error.message);
    },
  };
}
