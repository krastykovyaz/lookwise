import { NextResponse } from "next/server";
import { PhotoAnalyzeRequestSchema } from "@/lib/schemas";
import { analyzeProductPhoto, GeminiConfigError } from "@/lib/ai/gemini";

export const runtime = "nodejs";

// POST /api/buyer/photo-analyze — called when the user attaches or
// drops a product photo onto the search box (see
// components/ai/AIInput.tsx). Reuses the exact same request schema
// and validate-then-call-then-generic-error shape as
// /api/look/photo-analyze, but calls analyzeProductPhoto (a
// single-item analysis, not an outfit one) — see lib/ai/gemini.ts.
// It ONLY returns a concise description; it never searches eBay
// itself. Submitting the search from that description afterward goes
// through the existing, unmodified /api/buyer/search. No auth is
// required, same as the other buyer routes.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = PhotoAnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "Request must include a valid imageBase64 and mimeType." },
      { status: 400 },
    );
  }

  try {
    const analysis = await analyzeProductPhoto(parsed.data.imageBase64, parsed.data.mimeType, parsed.data.locale);
    return NextResponse.json({ analysis });
  } catch (err) {
    if (err instanceof GeminiConfigError) {
      return NextResponse.json(
        { error: "photo_analysis_not_configured", message: "Photo analysis isn't configured yet." },
        { status: 503 },
      );
    }
    console.error("[Compass] product photo analysis error:", err);
    return NextResponse.json(
      { error: "photo_analysis_failed", message: "Could not analyze this photo." },
      { status: 502 },
    );
  }
}
