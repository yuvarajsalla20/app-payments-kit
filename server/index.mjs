// The server side of app-payments-kit, for any runtime and any database. Plain JavaScript with no dependencies.
//
//   import { paymentsWebhook, supabaseStore, firestoreStore, handlePaymentEvent } from 'app-payments-kit/server.mjs';
//
// The webhook logic is the same for every backend; a store (`SubscriptionStore`) is the only part that knows the database.
export { handlePaymentEvent, paymentsWebhook, parseTiers, providerFromPath, PROVIDERS } from './handler.mjs';
export { accountIds, isAccountId, isNewer, isUuid, plan, sameSecret } from './core.mjs';
export { fromRevenueCat } from './revenuecat.mjs';
export { supabaseStore } from './stores/supabase.mjs';
export { firestoreStore, toDocument } from './stores/firestore.mjs';
