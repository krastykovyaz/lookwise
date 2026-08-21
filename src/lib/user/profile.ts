import "server-only";
import { getProfile as getProfileRow, upsertProfile as upsertProfileRow } from "@/lib/db/repositories/profile";
import type { UserStyleProfile } from "@/types/style";
import { computeProfileCompleteness } from "@/types/style";

/** Repository/service boundary so UI components never import Drizzle
 *  or the db client directly (section 5's requirement). This is the
 *  single function that turns a saved profile into the exact
 *  UserStyleProfile shape StyleProfileProvider already knows how to
 *  render — no duplicate profile logic anywhere else. */
export async function loadUserProfile(userId: string): Promise<UserStyleProfile | null> {
  return getProfileRow(userId);
}

export async function saveUserProfile(userId: string, profile: UserStyleProfile): Promise<UserStyleProfile> {
  const now = new Date().toISOString();
  const withCompleteness: UserStyleProfile = {
    ...profile,
    profileCompleteness: computeProfileCompleteness(profile),
    updatedAt: now,
    createdAt: profile.createdAt || now,
  };
  return upsertProfileRow(userId, withCompleteness);
}
