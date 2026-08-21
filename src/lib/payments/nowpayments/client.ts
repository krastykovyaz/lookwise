import "server-only";
import { getApiKey, apiBaseUrl, envLabel } from "@/lib/payments/nowpayments/env";

// Thin fetch wrapper for NOWPayments' REST API — connectivity/config
// verification only at this stage (section 1 of the payments spec: no
// subscription/checkout flow yet). Mirrors lib/ai/deepseek.ts's
// callDeepSeek and lib/ebay/client.ts's getEbayAccessToken: typed error
// classes, response bodies capped/whitespace-collapsed before ever
// reaching a log line, and the API key itself never logged anywhere.

export class NowPaymentsApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "NowPaymentsApiError";
    this.status = status;
  }
}

function safeUpstreamMessage(body: string): string {
  return body.replace(/\s+/g, " ").slice(0, 300);
}

async function nowPaymentsFetch<T>(
  path: string,
  { auth = true, method = "GET", body }: { auth?: boolean; method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const url = `${apiBaseUrl()}${path}`;
  const headers: Record<string, string> = {};
  // getApiKey() throws NowPaymentsConfigError before any request is
  // made if the key is missing — never sends an unauthenticated
  // request and calls it "checked".
  if (auth) headers["x-api-key"] = getApiKey();
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    console.error(`[Compass] NOWPayments error: network (${(err as Error).message})`);
    throw new NowPaymentsApiError(`Could not reach ${envLabel()}: ${(err as Error).message}`);
  }

  if (!response.ok) {
    const safe = safeUpstreamMessage(await response.text());
    console.error(`[Compass] NOWPayments error: HTTP ${response.status} ${safe}`);
    throw new NowPaymentsApiError(`${envLabel()} request failed (${response.status}): ${safe}`, response.status);
  }

  return (await response.json()) as T;
}

export interface NowPaymentsStatusResponse {
  message: string;
}

/** GET /v1/status — a plain health check, no API key required. Confirms
 *  the configured base URL itself is reachable, independent of whether
 *  the API key is valid. */
export async function getApiStatus(): Promise<NowPaymentsStatusResponse> {
  return nowPaymentsFetch<NowPaymentsStatusResponse>("/v1/status", { auth: false });
}

export interface NowPaymentsCurrenciesResponse {
  currencies: string[];
}

/** GET /v1/currencies — requires a valid x-api-key. NOWPayments
 *  returns 401 for a missing/invalid key, so a successful call here is
 *  the actual "do the credentials work" proof (section 4), not just
 *  that the API is reachable. */
export async function getSupportedCurrencies(): Promise<NowPaymentsCurrenciesResponse> {
  return nowPaymentsFetch<NowPaymentsCurrenciesResponse>("/v1/currencies");
}

export interface CreatePaymentInput {
  price_amount: number;
  price_currency: string;
  pay_currency?: string;
  order_id?: string;
  order_description?: string;
  ipn_callback_url?: string;
}

export interface CreatePaymentResponse {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  order_id: string | null;
  order_description: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /v1/payment — creates a real NOWPayments payment (money moves
 *  once a customer actually pays the returned pay_address; creating the
 *  payment object itself does not). Every field the caller supplies is
 *  sent as-is — this function has no business logic of its own about
 *  what price/currency to use; see
 *  lib/payments/nowpayments/checkout.ts for that (section 2: "never
 *  trust price/currency from the browser" is enforced there, by never
 *  accepting them as parameters from a request in the first place, not
 *  here). */
export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResponse> {
  return nowPaymentsFetch<CreatePaymentResponse>("/v1/payment", { method: "POST", body: input });
}
