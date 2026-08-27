import { NextResponse } from "next/server";
import { PhotoAnalyzeRequestSchema } from "@/lib/schemas";
import { analyzeOutfitPhoto, GeminiConfigError } from "@/lib/ai/gemini";

export const runtime = "nodejs";

// POST /api/look/photo-analyze — called when the user attaches or
// drops an outfit photo onto the existing "Anything else" field on
// /look (see app/look/page.tsx's handlePhotoFile). Mirrors
// /api/look/generate's shape (validate body, never trust the client
// further, generic error on failure) but does a fundamentally
// different, narrower thing: it ONLY returns a structured description
// of what's visible in the photo (see lib/ai/gemini.ts's
// analyzeOutfitPhoto and PhotoAnalysisSchema) — it never searches
// eBay and never creates a Look. No auth is required, same as
// /api/look/generate, so a guest can try this before onboarding.
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
    const analysis = await analyzeOutfitPhoto(parsed.data.imageBase64, parsed.data.mimeType, parsed.data.locale);
    return NextResponse.json({ analysis });
  } catch (err) {
    if (err instanceof GeminiConfigError) {
      return NextResponse.json(
        { error: "photo_analysis_not_configured", message: "Photo analysis isn't configured yet." },
        { status: 503 },
      );
    }
    console.error("[Compass] photo analysis error:", err);
    return NextResponse.json(
      { error: "photo_analysis_failed", message: "Could not analyze this photo." },
      { status: 502 },
    );
  }
}
