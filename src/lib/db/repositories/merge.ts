import "server-only";
import type { UserStyleProfile } from "@/types/style";
import type { Product } from "@/types/product";
import type { PreferenceEvent } from "@/types/events";
import { getProfile, upsertProfile } from "@/lib/db/repositories/profile";
import {
  recordEvent,
  recordViewedProduct,
  recordViewedLook,
  saveLook,
  saveProduct,
  upsertProductSignal,
  type LookSnapshotInput,
} from "@/lib/db/repositories/activity";

export interface AnonymousLocalState {
  profile?: UserStyleProfile | null;
  viewedProducts?: Product[];
  savedProducts?: Product[];
  savedLooks?: { lookId: string; look: LookSnapshotInput }[];
  viewedLooks?: { lookId: string; look: LookSnapshotInput }[];
  likedProductIds?: string[];
  dislikedProductIds?: string[];
  events?: PreferenceEvent[];
}

/** Deterministic merge, run once right after sign-in (see
 *  /api/merge). Section 10's rule — "do not overwrite newer
 *  authenticated data with stale anonymous data" — only applies to
 *  the profile, since it's the one thing here with a single current
 *  value; everything else (viewed/saved/likes/events) is an
 *  append-only log where "merge" just means "insert what's missing",
 *  so ordering never matters and duplicate calls are safe (every
 *  insert is idempotent via a unique constraint or is naturally
 *  append-only). */
export async function mergeAnonymousState(userId: string, local: AnonymousLocalState) {
  const summary = { profileMerged: false, viewed: 0, saved: 0, savedLooks: 0, viewedLooks: 0, signals: 0, events: 0 };

  if (local.profile) {
    const existing = await getProfile(userId);
    const localIsNewer =
      !existing || new Date(local.profile.updatedAt).getTime() > new Date(existing.updatedAt).getTime();
    if (localIsNewer) {
      // Field-level merge rather than blind overwrite: an existing
      // authenticated value wins per-field unless the local (newer)
      // profile actually set that field, so a partially-filled
      // anonymous profile can never blank out a field the account
      // already had from a previous session.
      const merged: UserStyleProfile = existing
        ? {
            styleArchetypes: local.profile.styleArchetypes.length ? local.profile.styleArchetypes : existing.styleArchetypes,
            preferredFit: local.profile.preferredFit ?? existing.preferredFit,
            preferredColors: local.profile.preferredColors.length ? local.profile.preferredColors : existing.preferredColors,
            dislikedColors: local.profile.dislikedColors.length ? local.profile.dislikedColors : existing.dislikedColors,
            preferredBrands: local.profile.preferredBrands.length ? local.profile.preferredBrands : existing.preferredBrands,
            dislikedBrands: local.profile.dislikedBrands.length ? local.profile.dislikedBrands : existing.dislikedBrands,
            budgetRange: local.profile.budgetRange ?? existing.budgetRange,
            location: local.profile.location ?? existing.location,
            favoriteCategories: local.profile.favoriteCategories.length ? local.profile.favoriteCategories : existing.favoriteCategories,
            dislikedCategories: local.profile.dislikedCategories.length ? local.profile.dislikedCategories : existing.dislikedCategories,
            profileCompleteness: 0,
            createdAt: existing.createdAt,
            updatedAt: local.profile.updatedAt,
          }
        : local.profile;
      await upsertProfile(userId, merged);
      summary.profileMerged = true;
    }
  }

  for (const product of local.viewedProducts ?? []) {
    await recordViewedProduct(userId, product);
    summary.viewed++;
  }
  for (const product of local.savedProducts ?? []) {
    await saveProduct(userId, product);
    summary.saved++;
  }
  for (const entry of local.savedLooks ?? []) {
    await saveLook(userId, entry.lookId, entry.look);
    summary.savedLooks++;
  }
  for (const entry of local.viewedLooks ?? []) {
    await recordViewedLook(userId, entry.lookId, entry.look);
    summary.viewedLooks++;
  }
  for (const productId of local.likedProductIds ?? []) {
    await upsertProductSignal(userId, productId, "like");
    summary.signals++;
  }
  for (const productId of local.dislikedProductIds ?? []) {
    await upsertProductSignal(userId, productId, "dislike");
    summary.signals++;
  }
  for (const event of local.events ?? []) {
    await recordEvent(userId, event);
    summary.events++;
  }

  return summary;
}
