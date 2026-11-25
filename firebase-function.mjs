/**
 * 2.11.0: The payments webhook as a Firebase Cloud Function. It keeps Firestore `subscriptions/{uid}` in step with the
 * payment provider, using the kit's shared server code (server/).
 *
 * In the app's `functions/index.js` (the functions package lists app-payments-kit, firebase-admin and firebase-functions):
 *
 *   export { paymentsWebhook } from 'app-payments-kit/firebase-function.mjs';
 *
 * or, for another region or collection names:
 *
 *   import { createPaymentsWebhook } from 'app-payments-kit/firebase-function.mjs';
 *   export const paymentsWebhook = createPaymentsWebhook({ region: 'europe-west1' });
 *
 * The first `firebase deploy --only functions` asks for the secret PAYMENTS_WEBHOOK_SECRET (any long random string) and
 * PAYMENTS_TIERS (tiers lowest first, e.g., "free,premium"), and keeps them for later deploys.
 *
 * RevenueCat → Project → Integrations → Webhooks: the function's URL (shown after the deploy), with the Authorization
 * header "Bearer <PAYMENTS_WEBHOOK_SECRET>". The app signs in to RevenueCat with the account's Firebase user id.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { firestoreStore, handlePaymentEvent, parseTiers, providerFromPath } from './server/index.mjs';

const SECRET = defineSecret('PAYMENTS_WEBHOOK_SECRET');
const TIERS = defineString('PAYMENTS_TIERS', { default: 'free,premium', description: 'The tiers, lowest first, e.g., free,premium.' });

/**
 * The request body: JSON that Cloud Functions has already read, or the raw bytes when it has not.
 * @param {{ body?: unknown, rawBody?: { toString(): string } }} req
 */
export async function readJsonBody(req) {
  const { body } = req;
  if (body && typeof body === 'object' && !(body instanceof Uint8Array)) return body;
  const text = req.rawBody ? req.rawBody.toString() : typeof body === 'string' ? body : '';
  return JSON.parse(text);
}

/**
 * The function, for a database in `region`, writing `collection` and `events`.
 * @param {{ region?: string, collection?: string, events?: string }} [options]
 */
export const createPaymentsWebhook = ({ region = 'us-central1', collection, events } = {}) =>
  onRequest({ region, secrets: [SECRET], maxInstances: 5, memory: '256MiB' }, async (req, res) => {
    if (!getApps().some((app) => app.name === '[DEFAULT]')) initializeApp();
    const result = await handlePaymentEvent(
      { method: req.method, provider: providerFromPath(req.path ?? ''), authorization: req.get('authorization') ?? '', readBody: () => readJsonBody(req) },
      {
        secret: SECRET.value(),
        tiers: parseTiers(TIERS.value()),
        store: firestoreStore(getFirestore(), { collection, events }),
        log: (message, detail) => logger.error(message, { detail }),
      },
    );
    res.status(result.status).json(result.body);
  });

/** The function for a database in us-central1 or nam5, the Firebase default. */
export const paymentsWebhook = createPaymentsWebhook();
