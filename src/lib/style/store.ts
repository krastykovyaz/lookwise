"use client";

// StyleProfile persistence boundary.
//
// There's no auth or database yet (see README), so this milestone
// persists to localStorage — same pattern as the locale preference in
// lib/i18n. The interface is deliberately storage-agnostic so it can
// be swapped for a real per-user backend (e.g. a REST call keyed off
// an authenticated user id) without touching any component.

import type { UserStyleProfile } from "@/types/style";

export interface StyleProfileStore {
  load(): UserStyleProfile | null;
  save(profile: UserStyleProfile): void;
  clear(): void;
}

const STORAGE_KEY = "compass.styleProfile";

class LocalStorageStyleProfileStore implements StyleProfileStore {
  load(): UserStyleProfile | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as UserStyleProfile;
      // Migrate profiles created before location/timezone was added.
      if (parsed.location) {
        parsed.location = {
          city: parsed.location.city ?? null,
          country: parsed.location.country ?? null,
          latitude: parsed.location.latitude ?? null,
          longitude: parsed.location.longitude ?? null,
          timezone: parsed.location.timezone ?? null,
          source: parsed.location.source ?? "manual",
        };
      }
      return parsed;
    } catch {
      // Corrupt or pre-migration data — treat as "no profile yet"
      // rather than throwing during render.
      return null;
    }
  }

  save(profile: UserStyleProfile): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  }

  clear(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export const styleProfileStore: StyleProfileStore = new LocalStorageStyleProfileStore();
