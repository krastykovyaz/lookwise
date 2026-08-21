import { NextResponse } from "next/server";
import { CityGeocodeRequestSchema } from "@/lib/schemas";
import { geocodeCity, GeocodingProviderError } from "@/lib/geocoding";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = CityGeocodeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "City is required." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await geocodeCity(parsed.data.city));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Geocoding failed.";
    console.error("[Compass] city geocode error:", message);
    return NextResponse.json(
      { error: "geocoding_failed", message },
      { status: err instanceof GeocodingProviderError ? 404 : 502 },
    );
  }
}
