import { NextResponse } from "next/server";
import { ReverseGeocodeRequestSchema } from "@/lib/schemas";
import { reverseGeocode, GeocodingProviderError } from "@/lib/geocoding";

export const runtime = "nodejs";

// Turns browser coordinates into a city/country. No provider is wired
// up yet (see /lib/geocoding) — this always returns
// geocoding_not_configured today, and the client already knows to
// fall back to a manual city field rather than treat this as fatal.
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

  const parsed = ReverseGeocodeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "Request must include numeric 'latitude' and 'longitude'.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await reverseGeocode(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GeocodingProviderError) {
      return NextResponse.json(
        {
          error: "geocoding_not_configured",
          message: "No reverse-geocoding provider is configured yet.",
        },
        { status: 501 },
      );
    }
    console.error("[Compass] reverse geocode error:", err);
    return NextResponse.json(
      { error: "geocoding_failed", message: "Couldn't resolve a city for that location." },
      { status: 502 },
    );
  }
}
