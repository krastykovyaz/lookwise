import { NextResponse } from "next/server";
import { LookGenerateRequestSchema } from "@/lib/schemas";
import { buildLookContext, lookGenerator, LookGeneratorError } from "@/lib/look";
import { getCurrentWeather, WeatherProviderError } from "@/lib/weather";
import type { UserStyleProfile } from "@/types/style";

export const runtime = "nodejs";

// Builds the real LookContext (profile + today's occasion/mood/free
// text) and hands it to the LookGenerator. The generator itself isn't
// implemented yet (see /lib/look) — this route exists so the request/
// response shape is already correct for the next milestone to plug
// the real AI stylist into, without any client changes.
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

  const parsed = LookGenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "Request must include 'profile' and 'current'." },
      { status: 400 },
    );
  }

  const { profile: rawProfile, current, locale, gender } = parsed.data;
  const profile: UserStyleProfile = {
    styleArchetypes: rawProfile.styleArchetypes as UserStyleProfile["styleArchetypes"],
    preferredFit: rawProfile.preferredFit ?? null,
    preferredColors: rawProfile.preferredColors,
    dislikedColors: rawProfile.dislikedColors,
    preferredBrands: rawProfile.preferredBrands,
    dislikedBrands: rawProfile.dislikedBrands,
    budgetRange: (rawProfile.budgetRange ?? null) as UserStyleProfile["budgetRange"],
    location: rawProfile.location
      ? {
          city: rawProfile.location.city ?? null,
          country: rawProfile.location.country ?? null,
          latitude: rawProfile.location.latitude ?? null,
          longitude: rawProfile.location.longitude ?? null,
          timezone: rawProfile.location.timezone ?? null,
          source: rawProfile.location.source,
        }
      : null,
    favoriteCategories: rawProfile.favoriteCategories,
    dislikedCategories: rawProfile.dislikedCategories,
    // Not part of this request schema — the gender that actually drives
    // this generation is the separate, required top-level `gender`
    // field above, not the persisted profile preference.
    gender: null,
    profileCompleteness: rawProfile.profileCompleteness,
    createdAt: rawProfile.createdAt,
    updatedAt: rawProfile.updatedAt,
  };
  const requestLocation = current.location
    ? {
        city: current.location.city ?? null,
        country: current.location.country ?? null,
        latitude: current.location.latitude ?? null,
        longitude: current.location.longitude ?? null,
        timezone: current.location.timezone ?? null,
        source: "geolocation" as const,
      }
    : profile.location;

  let weather = null;
  if (requestLocation?.latitude != null && requestLocation?.longitude != null) {
    try {
      weather = await getCurrentWeather(requestLocation);
    } catch (err) {
      if (!(err instanceof WeatherProviderError)) console.error("[Compass] weather error:", err);
      else console.warn(`[Compass] weather unavailable: ${err.message}`);
    }
  }

  const context = buildLookContext(profile, {
    intent: current.intent ?? null,
    occasion: current.occasion ?? null,
    activity: current.activity ?? null,
    mood: current.mood ?? null,
    freeText: current.freeText ?? null,
    location: requestLocation
      ? {
          city: requestLocation.city ?? null,
          country: requestLocation.country ?? null,
          latitude: requestLocation.latitude ?? null,
          longitude: requestLocation.longitude ?? null,
          timezone: requestLocation.timezone ?? null,
        }
      : null,
    budget: current.budget
      ? {
          min: current.budget.min ?? null,
          max: current.budget.max ?? null,
          currency: current.budget.currency ?? null,
        }
      : null,
    weather,
    temporal: current.temporal ?? null,
  }, parsed.data.preferenceSignals, locale, gender);

  try {
    const look = await lookGenerator.generateLook(context);
    return NextResponse.json({ look, context: { weather, temporal: current.temporal ?? null, location: requestLocation ?? null } });
  } catch (err) {
    console.error("[Compass] look generation error:", err);
    return NextResponse.json(
      { error: "look_generation_failed", message: "Something went wrong building your look." },
      { status: 502 },
    );
  }
}
