import { NextResponse } from "next/server";
import { ExploreQuerySchema } from "@/lib/schemas";
import type { RecommendationContext } from "@/types/explore";
import type { BudgetRangeId, StyleArchetypeId, UserLocation } from "@/types/style";
import { LOOK_INTENT_OPTIONS, MOOD_OPTIONS } from "@/types/style";
import { RECOMMENDATION_MIX } from "@/lib/recommendation/config";
import { recommendationEngine } from "@/lib/recommendation/engine";
import { addShownIds, addShownSellers, decodeCursor, getShownIds, getShownSellers } from "@/lib/recommendation/pool";
import { getCurrentWeather, WeatherProviderError } from "@/lib/weather";
import { computeTemporalContext } from "@/lib/recommendation/temporal";
import { createEmptyBehavioralPreferences } from "@/types/events";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const parsed = ExploreQuerySchema.safeParse(query);

  if (!parsed.success) {
    console.error("[Compass] explore feed error: invalid query params");
    return NextResponse.json(
      { error: "invalid_request", message: "Invalid query parameters.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const cursor = decodeCursor(input.cursor ?? null);
  const sessionId = input.sessionId ?? "anonymous";
  // sessionId + getShownIds is the single source of truth for what
  // this session has already been shown — the cursor no longer carries
  // its own excludeIds (see pool.ts).
  const excludeIds = getShownIds(sessionId);
  // Same mechanism, keyed on seller instead of product id — "do not
  // show more than 1 item from the one seller" in a session.
  const excludeSellers = getShownSellers(sessionId);

  // Compact behavioral signal reconstructed from the top/bottom labels
  // the client sends (see lib/events/behavioral.ts topLabels/bottomLabels)
  // rather than transporting full score maps over the query string.
  const behavioral = createEmptyBehavioralPreferences();
  for (const brand of input.topBrands) behavioral.brands[brand] = 0.8;
  for (const brand of input.bottomBrands) behavioral.brands[brand] = 0.2;
  for (const category of input.topCategories) behavioral.categories[category] = 0.8;
  for (const category of input.bottomCategories) behavioral.categories[category] = 0.2;

  let weather = null;
  if (input.lat != null && input.lon != null) {
    const location: UserLocation = {
      city: null,
      country: null,
      latitude: input.lat,
      longitude: input.lon,
      timezone: input.tz ?? null,
      source: "geolocation",
    };
    try {
      weather = await getCurrentWeather(location);
    } catch (err) {
      // Weather is optional context (section 16/22) — Explore still
      // works without it.
      if (!(err instanceof WeatherProviderError)) console.error("[Compass] explore weather error", err);
    }
  }

  const context: RecommendationContext = {
    profile:
      input.styles.length > 0 || input.budget || input.prefBrands.length > 0 || input.dislBrands.length > 0
        ? {
            styleArchetypes: input.styles as StyleArchetypeId[],
            budgetRange: (input.budget as BudgetRangeId) ?? null,
            preferredBrands: input.prefBrands,
            dislikedBrands: input.dislBrands,
            preferredColors: input.prefColors,
            dislikedColors: input.dislColors,
          }
        : null,
    behavioral,
    location: { latitude: input.lat ?? null, longitude: input.lon ?? null, timezone: input.tz ?? null },
    weather,
    temporal: input.tz ? computeTemporalContext(input.tz) : null,
    budgetRange: (input.budget as BudgetRangeId) ?? null,
    // Section 3: only ever use an occasion/mood the caller actually
    // sent — never invent one — and only if it's a value the existing
    // vocabulary recognizes.
    intent: input.intent && (LOOK_INTENT_OPTIONS as readonly string[]).includes(input.intent) ? input.intent : null,
    mood: input.mood && (MOOD_OPTIONS as readonly string[]).includes(input.mood) ? input.mood : null,
    excludeIds,
    excludeSellers,
    sessionId,
    poolGeneration: 0, // placeholder — engine.ts sets the real value when it creates a pool
    mix: RECOMMENDATION_MIX,
  };

  const debug = process.env.NODE_ENV !== "production" && input.debug === "1";

  try {
    const result = await recommendationEngine.getFeed(context, cursor, debug);
    const shownNow = result.items.flatMap((item) =>
      item.look.components.map((component) => component.productId).filter((id): id is string => Boolean(id)),
    );
    addShownIds(sessionId, shownNow);
    const sellersNow = result.items.flatMap((item) =>
      item.look.components.map((component) => component.product?.seller?.username).filter((s): s is string => Boolean(s)),
    );
    addShownSellers(sessionId, sellersNow);
    if (debug) {
      console.debug("[Compass] explore debug", JSON.stringify(result.items.map((i) => i.debug), null, 2));
    }
    return NextResponse.json(result);
  } catch (err) {
    // Section 22: a feed failure should degrade to an empty/error state
    // in the UI, never crash Explore.
    console.error("[Compass] explore feed error", err);
    return NextResponse.json(
      { error: "explore_unavailable", message: "Could not load recommendations right now." },
      { status: 503 },
    );
  }
}
