/**
 * App identity and business settings.
 * Change the product name, domain or prices here — nowhere else.
 */
export const APP = {
  /** Product name shown in the app, notifications and emails. */
  name: "Briefcast",
  /** Short line under the name on the welcome screen. */
  tagline: "Your daily thinking partner, in audio.",
  /** iOS bundle ID. Must match the App Store Connect app record. Cannot change after launch. */
  bundleId: "app.briefcast.ios",
  /** Main website domain. Used for legal pages and the MCP server. */
  domain: "briefcast.app",
  /** Newsletters are forwarded to <user-part>@<inboundEmailDomain>. */
  inboundEmailDomain: "in.briefcast.app",
  supportEmail: "support@briefcast.app",
  /** Shown in the app and on every episode page. App Store needs clear AI disclosure. */
  aiDisclosure: "Episodes and voices in this app are made by AI. Check important facts in the linked sources.",
} as const;

/**
 * Subscriptions (RevenueCat + StoreKit).
 * Real prices are set in App Store Connect. The values here are for display fallbacks and docs,
 * so keep them in sync. RevenueCat returns the real local price at runtime.
 */
export const SUBSCRIPTION = {
  entitlementId: "pro",
  trialDays: 7,
  products: {
    monthly: { id: "briefcast_pro_monthly", displayPriceUsd: 9.99 },
    yearly: { id: "briefcast_pro_yearly", displayPriceUsd: 79.99 },
  },
  /** Decision 2026-09-24: show the paywall after the first episode is ready, not before. */
  paywallAfterFirstEpisode: true,
} as const;
