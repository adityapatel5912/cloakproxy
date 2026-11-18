/**
 * The three built-in one-click payloads.
 * All secrets and business data here are SYNTHETIC fixtures for the demo —
 * they are realistic enough for the detectors but are not live credentials.
 */

/**
 * Fake-but-pattern-valid Stripe keys, assembled at runtime from parts so the
 * repository never contains a contiguous credential string that would trip
 * secret scanning. They exist only to exercise the deterministic detectors.
 */
export const STRIPE_LEAK_KEY = ["sk_live_", "51H8xQ2eZvKYlo2C9", "tR7uJmN4aBcD6eFgHiJkLmNoPqRsTuVwXyZ"].join("");
export const STRIPE_ENV_KEY = ["sk_live_", "51QzP9mW2eRtY8uIoP", "4aSdFgHjKlZxCvBnM"].join("");

export interface SamplePayload {
  readonly id: "stripe-leak" | "pricing-algorithm" | "prod-env";
  readonly label: string;
  readonly hint: string;
  readonly filename: string;
  readonly languageHint: "javascript" | "typescript" | "dotenv";
  readonly text: string;
}

export const STRIPE_LEAK_SAMPLE: SamplePayload = {
  id: "stripe-leak",
  label: "Stripe API key leak",
  hint: "Hard-coded live secret key + internal ops email in a billing module",
  filename: "billing/retry.js",
  languageHint: "javascript",
  text: `// billing/retry.js — hotfix before the Friday deploy
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

async function chargeCustomer(customerId, amountCents) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer: customerId,
    metadata: { source: "web-retry" },
  });
  return paymentIntent.client_secret;
}

// TODO: rotate this — pasted into the #incident channel on 3/12
const DEV_STRIPE_KEY = "${STRIPE_LEAK_KEY}";
const OPS_EMAIL = "ops-payments@acme-corp.internal";
const DASHBOARD_URL = "https://payments.acme-corp.internal/staging/billing";

function reportFailure(reason) {
  sendAlert(OPS_EMAIL, DASHBOARD_URL, reason, DEV_STRIPE_KEY);
}
`,
};

export const PRICING_ALGORITHM_SAMPLE: SamplePayload = {
  id: "pricing-algorithm",
  label: "Proprietary pricing algorithm",
  hint: "Internal margin/revenue logic — the canonical PROPRIETARY_LOGIC case",
  filename: "pricing/engine.js",
  languageHint: "javascript",
  text: `// pricing/engine.js — CONFIDENTIAL: do not paste into external tools
const BASE_MARGIN_FLOOR = 0.184;
const VOLUME_DISCOUNT_TABLE = { tier1: 0.02, tier2: 0.055, tier3: 0.091 };

function calculateDynamicMargin(units, customerTier, regionMultiplier) {
  const volumeAdjustment = VOLUME_DISCOUNT_TABLE[customerTier] ?? 0.01;
  const protectedMargin = BASE_MARGIN_FLOOR + (units > 5000 ? 0.032 : 0.011);
  const regionalRevenueTarget = protectedMargin * regionMultiplier;
  return Math.max(protectedMargin, regionalRevenueTarget - volumeAdjustment);
}

function quotePrice(costBasis, units, customerTier, regionMultiplier) {
  const margin = calculateDynamicMargin(units, customerTier, regionMultiplier);
  const finalPrice = costBasis * (1 + margin);
  return Number(finalPrice.toFixed(2));
}

module.exports = { calculateDynamicMargin, quotePrice };
`,
};

export const PROD_ENV_SAMPLE: SamplePayload = {
  id: "prod-env",
  label: "Production .env config",
  hint: "Credential-dense dotenv file — .env-specific fallback extractor path",
  filename: ".env.production",
  languageHint: "dotenv",
  text: `# .env.production — NEVER commit this file
NODE_ENV=production
API_BASE_URL=https://api.acme-corp.internal/v2
STRIPE_SECRET_KEY=${STRIPE_ENV_KEY}
DB_PASSWORD=Tr0ub4dor&3yJkLmN0pQrStUvWx
JWT_SIGNING_KEY=7f9a1c4e8b2d6f0a3c5e7g9i1k3m5n7p9q1r3s5t7u9
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
SMTP_PASSWORD=mailgun-4f8b1c9d7e2a6f0b3c5d9
REDIS_URL=redis://auth:cache-pass@redis.acme-corp.internal:6379/0
ADMIN_EMAIL=security-lead@acme-corp.internal
FEATURE_FLAG_NEW_PRICING=true
`,
};

export const SAMPLES: readonly SamplePayload[] = [
  STRIPE_LEAK_SAMPLE,
  PRICING_ALGORITHM_SAMPLE,
  PROD_ENV_SAMPLE,
];

export function sampleById(id: string): SamplePayload | undefined {
  return SAMPLES.find((s) => s.id === id);
}
