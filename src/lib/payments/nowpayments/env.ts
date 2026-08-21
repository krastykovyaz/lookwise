import "server-only";

// NOWPayments environment resolution — same shape as lib/ebay/env.ts's
// EBAY_ENV/EBAY_API_BASE_URL pair: NOWPAYMENTS_API_URL, when set, is a
// full override AND is how sandbox vs production is selected (sandbox
// and production are separate NOWPayments accounts with separate API
// keys, so a deployment sets NOWPAYMENTS_API_KEY and NOWPAYMENTS_API_URL
// together as a matched pair for whichever environment it targets).
// Defaults to sandbox so a deployment can never start hitting real
// payment infrastructure just because this var was left unset.
const PRODUCTION_BASE = "https://api.nowpayments.io";
const SANDBOX_BASE = "https://api-sandbox.nowpayments.io";

export class NowPaymentsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NowPaymentsConfigError";
  }
}

export function getApiKey(): string {
  const key = process.env.NOWPAYMENTS_API_KEY;
  if (!key) {
    throw new NowPaymentsConfigError(
      "NOWPAYMENTS_API_KEY is not set. Add it to your environment (see .env.example).",
    );
  }
  return key;
}

export function getIpnSecret(): string {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) {
    throw new NowPaymentsConfigError(
      "NOWPAYMENTS_IPN_SECRET is not set. Add it to your environment (see .env.example).",
    );
  }
  return secret;
}

export function apiBaseUrl(): string {
  const override = process.env.NOWPAYMENTS_API_URL?.trim();
  if (override) {
    // Normalized to the domain root — client.ts's request paths always
    // include their own leading "/v1/...". NOWPayments' own docs quote
    // "https://api.nowpayments.io/v1" as "the base URL", so a version
    // suffix here is the natural way to configure this; stripping it
    // rather than requiring an exact format avoids a silently-doubled
    // "/v1/v1/..." path if someone copies that value verbatim.
    return override.replace(/\/+$/, "").replace(/\/v1$/i, "");
  }
  return SANDBOX_BASE;
}

export function isProduction(): boolean {
  return apiBaseUrl() === PRODUCTION_BASE;
}

/** Human label used in log lines — mirrors ebayEnvLabel(). */
export function envLabel(): string {
  return isProduction() ? "NOWPayments Production" : "NOWPayments Sandbox";
}

export interface NowPaymentsConfigStatus {
  configured: boolean;
  /** Names only — never the values, so this is always safe to log or
   *  return from an API route as-is. */
  missing: string[];
  environment: "production" | "sandbox";
  apiBaseUrl: string;
}

/** Reports which required vars are missing without ever reading a
 *  secret's actual value into this function at all — only
 *  presence/absence is checked (section 6: "reports missing
 *  configuration without exposing secrets"). NOWPAYMENTS_API_URL is
 *  intentionally not "required" here — it has a safe sandbox default. */
export function checkNowPaymentsConfig(): NowPaymentsConfigStatus {
  const missing: string[] = [];
  if (!process.env.NOWPAYMENTS_API_KEY) missing.push("NOWPAYMENTS_API_KEY");
  if (!process.env.NOWPAYMENTS_IPN_SECRET) missing.push("NOWPAYMENTS_IPN_SECRET");

  return {
    configured: missing.length === 0,
    missing,
    environment: isProduction() ? "production" : "sandbox",
    apiBaseUrl: apiBaseUrl(),
  };
}
