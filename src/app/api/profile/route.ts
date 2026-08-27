import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { loadUserProfile, saveUserProfile } from "@/lib/user/profile";
import { z } from "zod";
import { BUDGET_RANGES, STYLE_ARCHETYPES } from "@/types/style";
import type { UserStyleProfile } from "@/types/style";

const locationSchema = z
  .object({
    city: z.string().nullable(),
    country: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    timezone: z.string().nullable(),
    source: z.enum(["geolocation", "manual"]),
  })
  .nullable();

const profileInputSchema = z.object({
  styleArchetypes: z.array(z.enum(STYLE_ARCHETYPES as [string, ...string[]])),
  preferredFit: z.string().nullable(),
  preferredColors: z.array(z.string()),
  dislikedColors: z.array(z.string()),
  preferredBrands: z.array(z.string()),
  dislikedBrands: z.array(z.string()),
  budgetRange: z.enum(BUDGET_RANGES as [string, ...string[]]).nullable(),
  location: locationSchema,
  favoriteCategories: z.array(z.string()),
  dislikedCategories: z.array(z.string()),
  gender: z.enum(["men", "women", "unisex"]).nullable(),
  profileCompleteness: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const profile = await loadUserProfile(userId);
    return NextResponse.json({ profile });
  } catch (err) {
    console.error("[GET /api/profile] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = profileInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const saved = await saveUserProfile(userId, parsed.data as UserStyleProfile);
    return NextResponse.json({ profile: saved });
  } catch (err) {
    console.error("[PUT /api/profile] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
