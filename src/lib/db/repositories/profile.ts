import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { UserStyleProfile, UserLocation, BudgetRangeId, StyleArchetypeId, LookGender } from "@/types/style";
import { computeProfileCompleteness } from "@/types/style";

type StyleProfileRow = typeof schema.styleProfiles.$inferSelect;

function rowToProfile(row: StyleProfileRow): UserStyleProfile {
  const location: UserLocation | null = row.locationCity || row.locationLatitude != null || row.locationCountry
    ? {
        city: row.locationCity,
        country: row.locationCountry,
        latitude: row.locationLatitude,
        longitude: row.locationLongitude,
        timezone: row.locationTimezone,
        source: (row.locationSource as UserLocation["source"]) ?? "manual",
      }
    : null;

  return {
    styleArchetypes: (row.styleArchetypes as StyleArchetypeId[]) ?? [],
    preferredFit: row.preferredFit,
    preferredColors: row.preferredColors ?? [],
    dislikedColors: row.dislikedColors ?? [],
    preferredBrands: row.preferredBrands ?? [],
    dislikedBrands: row.dislikedBrands ?? [],
    budgetRange: row.budgetRange as BudgetRangeId | null,
    location,
    favoriteCategories: row.favoriteCategories ?? [],
    dislikedCategories: row.dislikedCategories ?? [],
    gender: (row.genderPreference as LookGender | null) ?? null,
    profileCompleteness: computeProfileCompleteness({
      styleArchetypes: (row.styleArchetypes as StyleArchetypeId[]) ?? [],
      budgetRange: row.budgetRange as BudgetRangeId | null,
      location,
    }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Dedicated, minimal read/write for just the currency preference —
 *  reuses the same style_profile row/table as the rest of the profile
 *  (section 5: "do not create a second unrelated user-preference
 *  storage system") without requiring the full onboarding-profile
 *  payload upsertProfile expects. Safe to call before a user has ever
 *  completed onboarding: inserts a bare row (every other column is
 *  nullable/defaulted) rather than requiring one to already exist. */
export async function getUserCurrency(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ currency: schema.styleProfiles.currency })
    .from(schema.styleProfiles)
    .where(eq(schema.styleProfiles.userId, userId));
  return row?.currency ?? null;
}

export async function setUserCurrency(userId: string, currency: string): Promise<void> {
  const now = new Date();
  await db
    .insert(schema.styleProfiles)
    .values({ userId, currency, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: schema.styleProfiles.userId, set: { currency, updatedAt: now } });
}

export async function getProfile(userId: string): Promise<UserStyleProfile | null> {
  const [row] = await db.select().from(schema.styleProfiles).where(eq(schema.styleProfiles.userId, userId));
  return row ? rowToProfile(row) : null;
}

/** Upserts the full profile. Callers pass the complete UserStyleProfile
 *  (same shape the client already builds), so no partial-merge logic
 *  lives here — that ambiguity is resolved in lib/user/profile.ts. */
export async function upsertProfile(userId: string, profile: UserStyleProfile): Promise<UserStyleProfile> {
  const now = new Date();
  const values = {
    userId,
    styleArchetypes: profile.styleArchetypes,
    preferredFit: profile.preferredFit,
    preferredColors: profile.preferredColors,
    dislikedColors: profile.dislikedColors,
    preferredBrands: profile.preferredBrands,
    dislikedBrands: profile.dislikedBrands,
    budgetRange: profile.budgetRange,
    locationCity: profile.location?.city ?? null,
    locationCountry: profile.location?.country ?? null,
    locationLatitude: profile.location?.latitude ?? null,
    locationLongitude: profile.location?.longitude ?? null,
    locationTimezone: profile.location?.timezone ?? null,
    locationSource: profile.location?.source ?? null,
    favoriteCategories: profile.favoriteCategories,
    dislikedCategories: profile.dislikedCategories,
    genderPreference: profile.gender ?? null,
    updatedAt: now,
  };

  await db
    .insert(schema.styleProfiles)
    .values({ ...values, createdAt: now })
    .onConflictDoUpdate({ target: schema.styleProfiles.userId, set: values });

  const saved = await getProfile(userId);
  if (!saved) throw new Error("Profile upsert did not persist");
  return saved;
}
