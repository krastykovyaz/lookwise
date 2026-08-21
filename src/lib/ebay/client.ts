import "server-only";
import type { EbayOAuthTokenResponse } from "@/lib/ebay/types";

const TOKEN_BASE =
  process.env.EBAY_API_BASE_URL?.trim() || "https://api.sandbox.ebay.com";
const TOKEN_URL = `${TOKEN_BASE}/identity/v1/oauth2/token`;
const SCOPE = "https://api.ebay.com/oauth/api_scope";

// Module-level in-memory cache. Good enough for a single dev/server
// process; a real deployment with multiple instances would want a
// shared cache (Redis, etc.) instead — noted for a later milestone.
let cachedToken: { value: string; expiresAt: number } | null = null;

export class EbayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EbayConfigError";
  }
}

export class EbayAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EbayAuthError";
  }
}

function getCredentials() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new EbayConfigError(
      "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set. Add them to your environment (see .env.example).",
    );
  }
  return { clientId, clientSecret };
}

export async function getEbayAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.value;
  }

  const { clientId, clientSecret } = getCredentials();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: SCOPE,
      }),
    });
  } catch (err) {
    console.error(`[Compass] eBay auth error: network (${(err as Error).message})`);
    throw new EbayAuthError(
      `Could not reach eBay Sandbox OAuth endpoint: ${(err as Error).message}`,
    );
  }

  if (!response.ok) {
    // Body is eBay's OAuth error payload (error/error_description) — it
    // contains no credential material. Capped and whitespace-collapsed.
    const safe = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
    console.error(`[Compass] eBay auth error: HTTP ${response.status} ${safe}`);
    throw new EbayAuthError(
      `eBay Sandbox OAuth token request failed (${response.status}): ${safe}`,
    );
  }

  const data = (await response.json()) as EbayOAuthTokenResponse;
  cachedToken = {
    value: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return cachedToken.value;
}
