import "server-only";
import { EbaySearchCriteriaSchema, type ValidatedEbaySearchCriteria } from "@/lib/schemas";
import type { Product } from "@/types/product";
import type { Locale } from "@/types/locale";

// Ask Compass only ever needs this subset of a Product to answer a
// question — keeping the parameter narrow means callers (like the API
// route) don't need a full Product object or an unsafe cast to supply one.
export type AskableProduct = Pick<
  Product,
  | "title"
  | "price"
  | "currency"
  | "condition"
  | "brand"
  | "color"
  | "seller"
  | "location"
  | "shipping"
  | "returnPolicy"
  | "dealScore"
>;

const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
const DEEPSEEK_URL = `${DEEPSEEK_BASE_URL}/chat/completions`;
// Model is configurable so an unavailable/renamed model can be swapped
// without a code change. Default stays deepseek-v4-flash (see .env.example);
// we never silently substitute a different model.
const DEFAULT_MODEL = "deepseek-v4-flash";

function getModel(): string {
  const configured = process.env.DEEPSEEK_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_MODEL;
}

/**
 * Trims an upstream error body down to something safe to log/report:
 * no keys or headers are ever part of a response body, but we still cap
 * the length and strip anything that looks like a bearer token.
 */
function safeUpstreamMessage(body: string): string {
  return body
    .replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, "$1***")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

export class DeepSeekConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSeekConfigError";
  }
}

export class DeepSeekApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "DeepSeekApiError";
    this.status = status;
  }
}

export class DeepSeekOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSeekOutputError";
  }
}

function getApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new DeepSeekConfigError(
      "DEEPSEEK_API_KEY is not set. Add it to your environment (see .env.example).",
    );
  }
  return key;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

async function callDeepSeek(
  messages: ChatMessage[],
  { jsonMode = false }: { jsonMode?: boolean } = {},
): Promise<string> {
  const apiKey = getApiKey();
  const model = getModel();

  let response: Response;
  try {
    response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        temperature: 0.2,
      }),
    });
  } catch (err) {
    // Network-level failure. No credentials involved in the message.
    console.error(`[Compass] DeepSeek error: network (${(err as Error).message})`);
    throw new DeepSeekApiError(
      `Could not reach DeepSeek: ${(err as Error).message}`,
    );
  }

  if (!response.ok) {
    const safe = safeUpstreamMessage(await response.text());
    console.error(
      `[Compass] DeepSeek error: HTTP ${response.status} model="${model}" ${safe}`,
    );
    // Some models reject JSON mode (response_format). Retry once without it
    // — the system prompt already mandates a bare JSON object, and the
    // result still goes through EbaySearchCriteriaSchema either way.
    if (jsonMode && isJsonModeRejection(response.status, safe)) {
      console.warn(
        `[Compass] DeepSeek parsing retrying without response_format (model="${model}")`,
      );
      return callDeepSeek(messages, { jsonMode: false });
    }
    throw new DeepSeekApiError(
      `DeepSeek request failed (${response.status}): ${safe}`,
      response.status,
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new DeepSeekOutputError("DeepSeek response did not contain message content.");
  }
  return content;
}

function isJsonModeRejection(status: number, message: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const m = message.toLowerCase();
  return (
    m.includes("response_format") ||
    m.includes("json_object") ||
    m.includes("json mode")
  );
}

/**
 * Models that aren't in JSON mode sometimes wrap the object in a fenced
 * code block. Stripping the fence is not "loosening" validation — the
 * extracted object still has to pass EbaySearchCriteriaSchema.
 */
function extractJsonObject(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : content).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
}

const PARSE_SYSTEM_PROMPT = `You convert a shopper's natural-language request into structured search parameters for a pre-owned goods search on eBay.

Rules:
- You interpret intent only. You NEVER invent product listings, prices, sellers, or availability — that data comes from eBay, not you.
- Respond with a single JSON object only, no prose, matching exactly this shape:
{
  "query": string,            // core search terms, e.g. "Nike sneakers"
  "category": string | null,
  "brand": string | null,
  "condition": string[],      // e.g. ["used","pre-owned","very good"], [] if unspecified
  "color": string | null,
  "maxPrice": number | null,
  "currency": string | null,  // 3-letter ISO code, e.g. "USD", "EUR"
  "deliveryCountry": string | null, // 2-letter ISO code, e.g. "US", "LU"
  "size": string | null,
  "keywords": string[]        // extra useful search terms, [] if none
}
- If the request doesn't mention a field, use null (or [] for arrays). Do not guess a price or currency that wasn't implied.`;



export async function generateJsonObject(
  systemPrompt: string,
  userContent: string,
): Promise<unknown> {
  const content = await callDeepSeek(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    { jsonMode: true },
  );

  try {
    return JSON.parse(extractJsonObject(content));
  } catch {
    console.error("[Compass] DeepSeek error: generic JSON response was invalid");
    throw new DeepSeekOutputError("DeepSeek did not return valid JSON.");
  }
}

export async function parseBuyerRequest(
  request: string,
  locale: Locale,
): Promise<ValidatedEbaySearchCriteria> {
  const content = await callDeepSeek(
    [
      { role: "system", content: PARSE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `User locale: ${locale}\nUser request: ${request}`,
      },
    ],
    { jsonMode: true },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(content));
  } catch {
    console.error("[Compass] DeepSeek error: response was not valid JSON");
    throw new DeepSeekOutputError("DeepSeek did not return valid JSON.");
  }

  const result = EbaySearchCriteriaSchema.safeParse(parsed);
  if (!result.success) {
    console.error(
      `[Compass] DeepSeek error: schema validation failed (${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.code}`)
        .join("; ")})`,
    );
    throw new DeepSeekOutputError(
      `DeepSeek's structured output failed validation: ${result.error.message}`,
    );
  }
  return result.data;
}

const ASK_SYSTEM_PROMPT = `You are Ask Compass, answering a shopper's question about one specific pre-owned eBay listing.

Rules:
- Use ONLY the product data provided. Never invent facts not present in it.
- Clearly separate: facts from the listing, reasonable inference, and genuine uncertainty.
- NEVER claim certainty about authenticity — a listing alone cannot prove that.
- Keep the answer concise (2-4 sentences) and respond in the requested locale's language.
- If asked what to ask the seller, suggest specific, useful questions grounded in what's missing from the listing.`;

export async function askAboutProduct(
  question: string,
  product: AskableProduct,
  locale: Locale,
): Promise<string> {
  const productContext = JSON.stringify({
    title: product.title,
    price: product.price,
    currency: product.currency,
    condition: product.condition,
    brand: product.brand,
    color: product.color,
    seller: product.seller,
    location: product.location,
    shipping: product.shipping,
    returnPolicy: product.returnPolicy,
    dealScore: product.dealScore,
  });

  return callDeepSeek([
    { role: "system", content: ASK_SYSTEM_PROMPT },
    {
      role: "user",
      content: `User locale: ${locale}\nProduct data: ${productContext}\nQuestion: ${question}`,
    },
  ]);
}
