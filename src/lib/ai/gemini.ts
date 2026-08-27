import "server-only";
import { PhotoAnalysisSchema, type PhotoAnalysis } from "@/lib/schemas";
import { LOCALE_NAMES, type Locale } from "@/types/locale";

// Google's official Generative Language REST API — no SDK dependency,
// same "raw fetch" approach lib/ai/deepseek.ts already uses for its
// provider. https://ai.google.dev/api/generate-content
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com";
// Model is configurable so an unavailable/renamed model can be swapped
// without a code change — mirrors DEEPSEEK_MODEL's own doc in
// deepseek.ts. This exact scenario already happened once during this
// feature's own testing: gemini-2.5-flash returned a 404 telling
// callers to switch to gemini-3.6-flash — Google's model names churn,
// which is the whole reason this is env-configurable rather than only
// a hardcoded literal.
const DEFAULT_MODEL = "gemini-3.6-flash";

function getModel(): string {
  const configured = process.env.GEMINI_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_MODEL;
}

/**
 * Trims an upstream error body down to something safe to log/report: no
 * keys or headers are ever part of a response body, but we still cap the
 * length and strip anything that looks like a Gemini API key (they start
 * with "AIza").
 */
function safeUpstreamMessage(body: string): string {
  return body
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, "AIza***")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

export class GeminiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiConfigError";
  }
}

export class GeminiApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "GeminiApiError";
    this.status = status;
  }
}

export class GeminiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiOutputError";
  }
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new GeminiConfigError(
      "GEMINI_API_KEY is not set. Add it to your environment (see .env.example).",
    );
  }
  return key;
}

/** Calls Gemini's generateContent endpoint with one text prompt plus one
 *  inline image, asking for a JSON-only response. Returns the raw text
 *  Gemini produced — callers are responsible for parsing/validating it,
 *  same division of responsibility as lib/ai/deepseek.ts's callDeepSeek. */
async function callGeminiVision(
  promptText: string,
  imageBase64: string,
  mimeType: string,
): Promise<string> {
  const apiKey = getApiKey();
  const model = getModel();
  const url = `${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The officially documented header for a server-side API key —
        // keeps it out of the URL (and therefore out of access logs).
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: promptText }, { inlineData: { mimeType, data: imageBase64 } }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      }),
    });
  } catch (err) {
    console.error(`[Compass] Gemini error: network (${(err as Error).message})`);
    throw new GeminiApiError(`Could not reach Gemini: ${(err as Error).message}`);
  }

  if (!response.ok) {
    const safe = safeUpstreamMessage(await response.text());
    console.error(`[Compass] Gemini error: HTTP ${response.status} model="${model}" ${safe}`);
    throw new GeminiApiError(`Gemini request failed (${response.status}): ${safe}`, response.status);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .map((p: { text?: unknown }) => (typeof p?.text === "string" ? p.text : ""))
        .join("")
    : "";
  if (!text) {
    throw new GeminiOutputError("Gemini response did not contain any text content.");
  }
  return text;
}

/**
 * Models occasionally wrap the object in a fenced code block even in
 * JSON mode. Stripping the fence is not "loosening" validation — the
 * extracted object still has to pass PhotoAnalysisSchema.
 */
function extractJsonObject(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : content).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
}

const PHOTO_ANALYSIS_SYSTEM_PROMPT = `You are a fashion vision analyst. Look at the attached photo of an outfit and describe ONLY what is visible in the image.

Rules:
- Describe visible clothing items, shoes, and accessories individually.
- Never invent an item that isn't visible, and never invent a brand, price, or seller.
- Do not suggest where to buy anything — you are describing, not shopping.
- If a property (style, fit) isn't confidently recognizable for an item, use null for it rather than guessing.
- Respond with a single JSON object only, no prose, matching exactly this shape:
{
  "items": [
    { "category": string, "color": string | null, "style": string | null, "fit": string | null }
  ],
  "shoes": [
    { "category": string, "color": string | null, "style": string | null, "fit": string | null }
  ],
  "accessories": [
    { "category": string, "color": string | null, "style": string | null, "fit": string | null }
  ],
  "overallStyle": string[],
  "description": string
}
- "items" covers clothing only (tops, bottoms, outerwear, dresses, etc.) — not shoes or accessories, which have their own arrays.
- "overallStyle" is 1-4 short style descriptors for the whole outfit (e.g. "casual", "streetwear", "formal").
- If nothing is recognizable, return empty arrays rather than guessing.
- "description" is one or two natural-language sentences summarizing the outfit for a person who wants to shop for something similar — fluent prose, not a list. Describe only what's clearly visible; if something is uncertain, describe it conservatively (e.g. omit an unclear detail) rather than inventing it. Example style: "Beige oversized jacket over a white T-shirt, dark wide-leg trousers, black belt and white sneakers. Casual minimalist streetwear style." If nothing is recognizable, say so plainly instead of inventing an outfit.
- Write "description" in {{LANGUAGE}} — it's placed directly into the user's own look-request text field, which is always in that language. Every other field ("category", "color", "style", "fit", "overallStyle" entries) stays in English regardless of the requested language.`;

/** Analyzes one outfit photo and returns a validated, structured
 *  description — never a shopping search, never a generated Look; see
 *  this function's only caller (api/look/photo-analyze/route.ts) for
 *  why that boundary matters. `locale` controls only the language of
 *  the "description" field (see the prompt's own rule above) — it
 *  drives what actually lands in the user's free-text field, which is
 *  always in their app's current language. */
export async function analyzeOutfitPhoto(
  imageBase64: string,
  mimeType: string,
  locale: Locale,
): Promise<PhotoAnalysis> {
  const prompt = PHOTO_ANALYSIS_SYSTEM_PROMPT.replace("{{LANGUAGE}}", LOCALE_NAMES[locale]);
  const content = await callGeminiVision(prompt, imageBase64, mimeType);

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(content));
  } catch {
    console.error("[Compass] Gemini error: response was not valid JSON");
    throw new GeminiOutputError("Gemini did not return valid JSON.");
  }

  const result = PhotoAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    console.error(
      `[Compass] Gemini error: schema validation failed (${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.code}`)
        .join("; ")})`,
    );
    throw new GeminiOutputError(`Gemini's structured output failed validation: ${result.error.message}`);
  }
  return result.data;
}
