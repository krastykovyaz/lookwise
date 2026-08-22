"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { GeneratedLook } from "@/types/style";
import { syncViewedLook } from "@/lib/db/clientSync";

const STORAGE_KEY = "compass.lookHistory";
const LEGACY_STORAGE_KEY = "compass.latestLook";
const MAX_LOOKS = 20;

/** How many entries Overview shows for "Recently viewed looks" — the
 *  underlying history (MAX_LOOKS above) stays larger so switching
 *  screens doesn't lose recent-but-not-latest looks; this only bounds
 *  what's rendered. Kept in sync with viewed.tsx's RECENT_VIEW_LIMIT
 *  for products, since both live in the same Overview sections. */
export const RECENT_VIEW_LIMIT = 10;

export interface LookHistoryEntry {
  id: string;
  createdAt: string;
  /** Set only when the user actually opens this look. */
  viewedAt?: string;
  look: GeneratedLook;
}

interface LookHistoryContextValue {
  looks: LookHistoryEntry[];
  latestLook: GeneratedLook | null;
  isLoaded: boolean;
  /** Records a look as viewed/generated — this is VIEW history only.
   *  It never writes to the saved_look table (see lib/look/savedLooks.tsx
   *  for the explicit "user pressed Save" concept). Renamed from an
   *  earlier `saveLook` — the old name was actively misleading: every
   *  caller here was recording a view/generation, not a save, and a
   *  viewed look was incorrectly showing up as "saved" in the UI as a
   *  result (Overview's Saved section, Explore's bookmark icon). */
  recordLookHistory: (look: GeneratedLook) => GeneratedLook;
  recordViewedLook: (look: GeneratedLook) => GeneratedLook;
  getLook: (id: string) => GeneratedLook | null;
  clearLook: (id?: string) => void;
  /** True while a "Create my look" generation is in flight, from click
   *  until it resolves or fails. Lives here (root-level, survives
   *  navigation) rather than as local state on the /look page itself —
   *  the generation request is a fire-and-forget fetch that keeps
   *  running after the user navigates away, so if this were local
   *  state, returning to /look mid-generation would remount the page
   *  with a fresh, idle button, inviting a duplicate click on a
   *  generation that's still actually running. */
  isGeneratingLook: boolean;
  setIsGeneratingLook: (value: boolean) => void;
}

const LookHistoryContext = createContext<LookHistoryContextValue | null>(null);

function createLookId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `look-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeLook(raw: GeneratedLook): GeneratedLook {
  return {
    ...raw,
    id: raw.id ?? createLookId(),
    createdAt: raw.createdAt ?? new Date().toISOString(),
    components: Array.isArray(raw.components)
      ? raw.components.map((component) => ({
          ...component,
          alternatives: Array.isArray(component.alternatives) ? component.alternatives : [],
        }))
      : [],
    styleNotes: Array.isArray(raw.styleNotes) ? raw.styleNotes : [],
  };
}

function normalizeEntries(raw: unknown): LookHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === "object" && "look" in entry)
    .map((entry) => {
      const value = entry as Partial<LookHistoryEntry>;
      const look = normalizeLook(value.look as GeneratedLook);
      return {
        id: value.id ?? look.id!,
        createdAt: value.createdAt ?? look.createdAt!,
        viewedAt: value.viewedAt,
        look,
      };
    })
    .slice(0, MAX_LOOKS);
}

export function LookHistoryProvider({ children }: { children: React.ReactNode }) {
  const [looks, setLooks] = useState<LookHistoryEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isGeneratingLook, setIsGeneratingLook] = useState(false);
  const { status } = useSession();

  useEffect(() => {
    try {
      const rawHistory = window.localStorage.getItem(STORAGE_KEY);
      if (rawHistory) {
        setLooks(normalizeEntries(JSON.parse(rawHistory)));
      } else {
        // Migrate the previous single-look storage format once.
        const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          const look = normalizeLook(JSON.parse(legacy) as GeneratedLook);
          setLooks([{ id: look.id!, createdAt: look.createdAt!, look }]);
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify([{ id: look.id, createdAt: look.createdAt, look }]),
          );
        }
      }
    } catch {
      setLooks([]);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const recordLookHistory = useCallback((look: GeneratedLook) => {
    const normalized = normalizeLook(look);
    setLooks((current) => {
      const existing = current.find((entry) => entry.id === normalized.id);
      const entry: LookHistoryEntry = {
        id: normalized.id!,
        createdAt: normalized.createdAt!,
        viewedAt: existing?.viewedAt,
        look: normalized,
      };
      const existingIndex = current.findIndex((item) => item.id === normalized.id);
      const next =
        existingIndex >= 0
          ? current.map((item, index) => (index === existingIndex ? entry : item))
          : [entry, ...current];
      const trimmed = next.slice(0, MAX_LOOKS);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } catch {}
      return trimmed;
    });
    return normalized;
  }, []);

  const recordViewedLook = useCallback((look: GeneratedLook) => {
    const normalized = normalizeLook(look);
    const viewedAt = new Date().toISOString();
    setLooks((current) => {
      const existingIndex = current.findIndex((entry) => entry.id === normalized.id);
      const entry: LookHistoryEntry = {
        id: normalized.id!,
        createdAt: normalized.createdAt!,
        viewedAt,
        look: normalized,
      };
      const next =
        existingIndex >= 0
          ? current.map((item, index) => (index === existingIndex ? entry : item))
          : [entry, ...current];
      const trimmed = next.slice(0, MAX_LOOKS);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } catch {
        // Keep in-memory history when storage is unavailable/full.
      }
      return trimmed;
    });
    // Server-side view record for authenticated users (section 4:
    // "persist it server-side... survive refresh and login on another
    // device"). Mirrors the same fire-and-forget pattern as
    // ViewedProductsProvider/FavoritesProvider — local state (already
    // updated above) is never blocked on this.
    if (status === "authenticated" && normalized.id) syncViewedLook(normalized.id, normalized);
    return normalized;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const getLook = useCallback(
    (id: string) => looks.find((entry) => entry.id === id)?.look ?? null,
    [looks],
  );

  const clearLook = useCallback((id?: string) => {
    if (!id) {
      setLooks([]);
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {}
      return;
    }
    setLooks((current) => {
      const next = current.filter((entry) => entry.id !== id);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const latestLook = looks[0]?.look ?? null;

  const value = useMemo(
    () => ({
      looks,
      latestLook,
      isLoaded,
      recordLookHistory,
      recordViewedLook,
      getLook,
      clearLook,
      isGeneratingLook,
      setIsGeneratingLook,
    }),
    [looks, latestLook, isLoaded, recordLookHistory, recordViewedLook, getLook, clearLook, isGeneratingLook],
  );

  return <LookHistoryContext.Provider value={value}>{children}</LookHistoryContext.Provider>;
}

export function useLookHistory() {
  const ctx = useContext(LookHistoryContext);
  if (!ctx) throw new Error("useLookHistory must be used within LookHistoryProvider");
  return ctx;
}
