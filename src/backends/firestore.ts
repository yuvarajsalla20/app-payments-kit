import { doc, getDoc, type Firestore } from 'firebase/firestore';
import type { ServerSubscription, SubscriptionBackend, SubscriptionStatus } from '../core/types';

export interface FirestoreBackendOptions {
  /** Default 'subscriptions' (written by the kit's Firebase function). */
  collection?: string;
}

/**
 * Reads the signed-in account's own document, `subscriptions/{uid}`. The rules in firestore/subscriptions.rules let an
 * account read only its own document and never write it; only the webhook writes it.
 */
export function firestoreBackend(db: Firestore | null | undefined, options: FirestoreBackendOptions = {}): SubscriptionBackend {
  const collection = options.collection ?? 'subscriptions';
  return {
    async read(userId) {
      if (!db) return null;
      const snap = await getDoc(doc(db, collection, userId));
      if (!snap.exists()) return null;
      const d = snap.data() as Record<string, unknown>;
      const out: ServerSubscription = {
        tier: String(d.tier ?? 'free'),
        activeUntil: (d.activeUntil as string | null) ?? null,
        status: (d.status as SubscriptionStatus | null) ?? null,
        willRenew: (d.willRenew as boolean | null) ?? null,
        provider: (d.provider as string | null) ?? null,
        productId: (d.productId as string | null) ?? null,
      };
      return out;
    },
  };
}
