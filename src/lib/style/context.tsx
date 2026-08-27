"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSession } from "next-auth/react";
import type {
  BudgetRangeId,
  LookGender,
  StyleArchetypeId,
  UserLocation,
  UserStyleProfile,
} from "@/types/style";
import { computeProfileCompleteness, createEmptyStyleProfile } from "@/types/style";
import { styleProfileStore } from "@/lib/style/store";

async function fetchServerProfile(): Promise<UserStyleProfile | null> {
  try {
    const res = await fetch("/api/profile");
    if (!res.ok) return null;
    const data = (await res.json()) as { profile: UserStyleProfile | null };
    return data.profile;
  } catch {
    return null;
  }
}

async function putServerProfile(profile: UserStyleProfile): Promise<UserStyleProfile | null> {
  try {
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { profile: UserStyleProfile };
    return data.profile;
  } catch {
    return null;
  }
}

interface StyleProfileContextValue {
  profile: UserStyleProfile | null;
  /** True once the client-only localStorage read has resolved, so the
   *  UI can avoid a flash of "no profile" while hydrating. */
  isLoaded: boolean;
  /** True when the fields this milestone's onboarding collects are
   *  all present — not necessarily 100% of computeProfileCompleteness. */
  hasOnboarded: boolean;
  saveProfile: (partial: {
    styleArchetypes: StyleArchetypeId[];
    budgetRange: BudgetRangeId | null;
    location: UserLocation | null;
    /** Omit to leave the existing value untouched — onboarding's save
     *  doesn't know about gender and shouldn't accidentally clear it. */
    gender?: LookGender | null;
  }) => void;
  clearProfile: () => void;
  /** Re-fetches the authenticated user's profile from the server.
   *  Called once by MergeOnSignIn right after the anonymous->account
   *  merge lands, so newly-merged fields show up without a reload. */
  refreshFromServer: () => Promise<void>;
}

const StyleProfileContext = createContext<StyleProfileContextValue | null>(null);

export function StyleProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserStyleProfile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";

  useEffect(() => {
    if (status === "loading") return;
    // For a signed-in user the database is the source of truth
    // (section 5: "StyleProfileProvider should transparently load the
    // authenticated user's profile from the database"). For everyone
    // else this is unchanged: a one-shot hydration from localStorage,
    // same as I18nProvider's locale read.
    let cancelled = false;
    async function load() {
      if (isAuthenticated) {
        const server = await fetchServerProfile();
        if (!cancelled) setProfile(server);
      } else {
        const loaded = styleProfileStore.load();
        if (!cancelled) setProfile(loaded);
      }
      if (!cancelled) setIsLoaded(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, status]);

  const saveProfile = useCallback(
    (partial: {
      styleArchetypes: StyleArchetypeId[];
      budgetRange: BudgetRangeId | null;
      location: UserLocation | null;
      gender?: LookGender | null;
    }) => {
      const base = profile ?? createEmptyStyleProfile();
      const next: UserStyleProfile = {
        ...base,
        styleArchetypes: partial.styleArchetypes,
        budgetRange: partial.budgetRange,
        location: partial.location,
        gender: partial.gender !== undefined ? partial.gender : base.gender,
        updatedAt: new Date().toISOString(),
      };
      next.profileCompleteness = computeProfileCompleteness(next);
      setProfile(next);
      if (isAuthenticated) {
        void putServerProfile(next).then((saved) => {
          if (saved) setProfile(saved);
        });
      } else {
        styleProfileStore.save(next);
      }
    },
    [profile, isAuthenticated],
  );

  const clearProfile = useCallback(() => {
    styleProfileStore.clear();
    setProfile(null);
  }, []);

  const refreshFromServer = useCallback(async () => {
    if (!isAuthenticated) return;
    const server = await fetchServerProfile();
    setProfile(server);
  }, [isAuthenticated]);

  const hasOnboarded = useMemo(
    () =>
      !!profile &&
      profile.styleArchetypes.length > 0,
    [profile],
  );

  const value = useMemo(
    () => ({ profile, isLoaded, hasOnboarded, saveProfile, clearProfile, refreshFromServer }),
    [profile, isLoaded, hasOnboarded, saveProfile, clearProfile, refreshFromServer],
  );

  return (
    <StyleProfileContext.Provider value={value}>
      {children}
    </StyleProfileContext.Provider>
  );
}

export function useStyleProfile() {
  const ctx = useContext(StyleProfileContext);
  if (!ctx) throw new Error("useStyleProfile must be used within StyleProfileProvider");
  return ctx;
}
