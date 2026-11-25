// The webhook's store for Cloud Firestore, written with the Admin SDK (firebase-admin), which security rules do not limit.
//
// subscriptions/{uid}            one document per account: { tier, activeUntil, status, willRenew, provider, store,
//                                productId, environment, eventAt, updatedAt } (dates as ISO strings)
// subscriptionEvents/{eventId}   one document per event applied: { userId, provider, type, payload, receivedAt }
//
// The app reads its own document with `firestoreBackend(db)` from app-payments-kit/firestore. Rules that let each account
// read only its own document and never write it: firestore/subscriptions.rules.

/** @typedef {import('../handler.mjs').SubscriptionStore} SubscriptionStore */
/** @typedef {import('../core.mjs').Row} Row */

/**
 * @typedef {object} FirestoreStoreOptions
 * @property {string} [collection] Default 'subscriptions'.
 * @property {string} [events] Default 'subscriptionEvents'.
 */

/** A document id for an event id: Firestore ids may not contain a slash. */
const eventDoc = (/** @type {string} */ id) => id.replace(/\//g, '_').slice(0, 1500);

/**
 * A stored document → the fields the webhook compares.
 * @param {string} userId
 * @param {Record<string, any>} d
 */
const toStored = (userId, d) => ({ user_id: userId, tier: String(d.tier ?? 'free'), active_until: d.activeUntil ?? null, will_renew: d.willRenew ?? null, event_at: d.eventAt ?? null });

/**
 * The row → the document written for it.
 * @param {Row} row
 */
export const toDocument = (row) => ({
  tier: row.tier,
  activeUntil: row.active_until,
  status: row.status,
  willRenew: row.will_renew,
  provider: row.provider,
  store: row.store,
  productId: row.product_id,
  environment: row.environment,
  eventAt: row.event_at,
  updatedAt: row.updated_at,
});

/**
 * Account ids are Firebase user ids. Firestore has no list of accounts to check against, so every real id gets a document.
 * @param {any} db The Admin SDK's Firestore (`getFirestore()` from firebase-admin/firestore).
 * @param {FirestoreStoreOptions} [options]
 * @returns {SubscriptionStore}
 */
export function firestoreStore(db, options = {}) {
  const rows = db.collection(options.collection ?? 'subscriptions');
  const events = db.collection(options.events ?? 'subscriptionEvents');
  return {
    async hasEvent(id) {
      return (await events.doc(eventDoc(id)).get()).exists;
    },
    async readRows(ids) {
      const snaps = await Promise.all([...new Set(ids)].filter((id) => !!id && !id.includes('/')).map((id) => rows.doc(id).get()));
      return snaps.filter((s) => s.exists).map((s) => toStored(s.id, s.data() ?? {}));
    },
    async writeRow(row) {
      await rows.doc(row.user_id).set(toDocument(row));
      return 'written';
    },
    async logEvent(event) {
      await events.doc(eventDoc(event.id)).set({ userId: event.userId, provider: event.provider, type: event.type, payload: event.payload ?? null, receivedAt: new Date().toISOString() });
    },
  };
}
