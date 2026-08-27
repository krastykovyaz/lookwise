/**
 * Regression tests for the "Build from photo" flow's structured-output
 * contract: the Zod schemas that validate both the client's request and
 * Gemini's response (lib/schemas.ts), and the Gemini client's config
 * guard (lib/ai/gemini.ts). Deliberately never calls the real Gemini
 * API — GEMINI_API_KEY is explicitly cleared before the config-guard
 * test so this is reproducible regardless of the local environment.
 * Run: npm run verify:photo
 */
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PhotoAnalysisSchema, PhotoAnalyzeRequestSchema } from "../src/lib/schemas";

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  console.log(`  ${detail}`);
}

// --- PhotoAnalysisSchema (Gemini's structured output) ------------------

const SAMPLE_DESCRIPTION =
  "Beige oversized jacket over a white T-shirt, dark wide-leg trousers, black belt and white sneakers. Casual minimalist streetwear style.";

check(
  "a well-formed Gemini response (matching the spec's example) validates",
  PhotoAnalysisSchema.safeParse({
    items: [{ category: "jacket", color: "beige", style: "oversized", fit: "oversized" }],
    shoes: [],
    accessories: [],
    overallStyle: ["casual", "streetwear"],
    description: SAMPLE_DESCRIPTION,
  }).success,
  "expected success: true",
);

check(
  "nullable fields (color/style/fit) are accepted as null, not just omitted",
  PhotoAnalysisSchema.safeParse({
    items: [{ category: "t-shirt", color: null, style: null, fit: null }],
    shoes: [],
    accessories: [],
    overallStyle: [],
    description: "A plain white T-shirt.",
  }).success,
  "expected success: true",
);

check(
  "an item missing its required category is rejected",
  !PhotoAnalysisSchema.safeParse({
    items: [{ color: "black", style: null, fit: null }],
    shoes: [],
    accessories: [],
    overallStyle: [],
    description: SAMPLE_DESCRIPTION,
  }).success,
  "expected success: false",
);

{
  const result = PhotoAnalysisSchema.safeParse({ description: "Nothing clearly recognizable in this photo." });
  check(
    "missing arrays default to empty rather than failing validation (a photo with nothing recognizable)",
    result.success &&
      result.data.items.length === 0 &&
      result.data.shoes.length === 0 &&
      result.data.accessories.length === 0 &&
      result.data.overallStyle.length === 0,
    `success: ${result.success}`,
  );
}

check(
  "an empty-string category is rejected (min(1))",
  !PhotoAnalysisSchema.safeParse({
    items: [{ category: "", color: null, style: null, fit: null }],
    shoes: [],
    accessories: [],
    overallStyle: [],
    description: SAMPLE_DESCRIPTION,
  }).success,
  "expected success: false",
);

// --- description: the field this feature added (feeds /look's
// existing "Anything else" field — see app/look/photo/page.tsx and
// app/look/page.tsx). ----------------------------------------------------

check(
  "a response missing description entirely is rejected — the natural-language summary is required, not optional",
  !PhotoAnalysisSchema.safeParse({ items: [], shoes: [], accessories: [], overallStyle: [] }).success,
  "expected success: false",
);

check(
  "an empty-string description is rejected (min(1))",
  !PhotoAnalysisSchema.safeParse({
    items: [],
    shoes: [],
    accessories: [],
    overallStyle: [],
    description: "",
  }).success,
  "expected success: false",
);

check(
  "a description over 500 characters is rejected",
  !PhotoAnalysisSchema.safeParse({
    items: [],
    shoes: [],
    accessories: [],
    overallStyle: [],
    description: "a".repeat(501),
  }).success,
  "expected success: false",
);

// --- PhotoAnalyzeRequestSchema (what the client sends) ------------------

check(
  "a valid request (base64 + a supported mime type) is accepted",
  PhotoAnalyzeRequestSchema.safeParse({ imageBase64: "aGVsbG8=", mimeType: "image/jpeg" }).success,
  "expected success: true",
);

for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
  check(
    `mimeType "${mimeType}" is accepted`,
    PhotoAnalyzeRequestSchema.safeParse({ imageBase64: "aGVsbG8=", mimeType }).success,
    "expected success: true",
  );
}

check(
  "an unsupported mime type (e.g. image/gif) is rejected — only formats the analyzer actually accepts",
  !PhotoAnalyzeRequestSchema.safeParse({ imageBase64: "aGVsbG8=", mimeType: "image/gif" }).success,
  "expected success: false",
);

check(
  "an empty imageBase64 is rejected",
  !PhotoAnalyzeRequestSchema.safeParse({ imageBase64: "", mimeType: "image/jpeg" }).success,
  "expected success: false",
);

check(
  "a request missing mimeType entirely is rejected",
  !PhotoAnalyzeRequestSchema.safeParse({ imageBase64: "aGVsbG8=" }).success,
  "expected success: false",
);

// --- Gemini client: config guard, no real API call ever made -----------

async function checkConfigGuard() {
  // Deliberately cleared, regardless of what the real environment has,
  // so this test is reproducible and NEVER reaches the network — see
  // lib/ai/gemini.ts's getApiKey(), which throws before any fetch.
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const { analyzeOutfitPhoto, GeminiConfigError } = await import("../src/lib/ai/gemini");
    try {
      await analyzeOutfitPhoto("aGVsbG8=", "image/jpeg");
      check("analyzeOutfitPhoto without GEMINI_API_KEY throws before any network call", false, "did not throw");
    } catch (err) {
      check(
        "analyzeOutfitPhoto without GEMINI_API_KEY throws GeminiConfigError (never attempts a real API call)",
        err instanceof GeminiConfigError,
        `error: ${err instanceof Error ? err.constructor.name : String(err)}`,
      );
    }
  } finally {
    if (original !== undefined) process.env.GEMINI_API_KEY = original;
  }
}

// --- Structural checks: the route validates before calling Gemini, and
// never leaks internals on failure — same pattern verify-payments.ts
// uses for its own route source checks. ---------------------------------
function checkRouteStructure() {
  const routeSource = readFileSync(
    path.join(__dirname, "..", "src", "app", "api", "look", "photo-analyze", "route.ts"),
    "utf8",
  );
  check(
    "the route validates the request body with PhotoAnalyzeRequestSchema before calling analyzeOutfitPhoto",
    routeSource.indexOf("PhotoAnalyzeRequestSchema.safeParse(body)") <
      routeSource.indexOf("analyzeOutfitPhoto("),
    "expected schema validation to appear before the Gemini call in source order",
  );
  check(
    "a missing GEMINI_API_KEY (GeminiConfigError) is reported as 'not configured', not a generic failure",
    /GeminiConfigError/.test(routeSource) && /photo_analysis_not_configured/.test(routeSource),
    "expected both GeminiConfigError handling and the not-configured error code",
  );
  check(
    "the route never reads eBay, payments, or Look-generation modules — it only describes a photo",
    !/from "@\/lib\/ebay/.test(routeSource) &&
      !/from "@\/lib\/payments/.test(routeSource) &&
      !/lookGenerator/.test(routeSource),
    "expected no cross-feature imports",
  );
}

async function main() {
  await checkConfigGuard();
  checkRouteStructure();

  console.log(`\n${failures === 0 ? "All photo-analysis checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
