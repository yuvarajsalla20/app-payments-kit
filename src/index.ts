// `import { createPaymentsKit } from 'app-payments-kit'`: the core, with no payment vendor in it.
// Providers and backends have their own entry points (app-payments-kit/revenuecat, /revenuecat-web, /supabase),
// so an app only bundles the vendors it uses.
export { createPaymentsKit, type PaymentsKit, type PaymentsKitOptions, type TesterStorage, type TierSource, type TierState } from './core/createPaymentsKit';
export { DEFAULT_MESSAGES, periodDays, type PaymentMessages } from './core/messages';
export { FREE, highest, normalizeTiers, rank } from './core/tiers';
export type { BuyResult, PaymentProvider, Period, PeriodUnit, Plan, ServerSubscription, SubscriptionBackend, SubscriptionStatus } from './core/types';
