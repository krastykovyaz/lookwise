"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { GeneratedLook } from "@/types/style";
import { syncSaveLook, syncUnsaveLook } from "@/lib/db/clientSync";

const STORAGE_KEY = "compass.savedLooks";
const MAX_SAVED_LOOKS = 100;

export interface SavedLookEntry {
  id: string;
  savedAt: string;
  look: GeneratedLook;
}

interface SavedLooksContextValue {
  savedLooks: SavedLookEntry[];
  isLoaded: boolean;
  /** See FavoritesProvider's isServerSynced for the full rationale —
   *  same idea, for saved looks. */
  isServerSynced: boolean;
  isSaved: (lookId: string) => boolean;
  /** Explicit user action only — this is the ONLY place that writes to
   *  saved_look (via syncSaveLook/syncUnsaveLook). Merely viewing a
   *  look must never call this — see lib/look/history.tsx's
   *  recordViewedLook for that. Toggles: saving an already-saved look
   *  unsaves it. */
  toggleSaved: (look: GeneratedLook) => void;
  removeSaved: (lookId: string) => void;
}

const SavedLooksContext = createContext<SavedLooksContextValue | null>(null);

export function SavedLooksProvider({ children }: { children: React.ReactNode }) {
  const [savedLooks, setSavedLooks] = useState<SavedLookEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const { status } = useSession();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SavedLookEntry>[];
        const normalized = Array.isArray(parsed)
          ? parsed
              .filter((entry): entry is SavedLookEntry => Boolean(entry && entry.look && entry.id))
              .slice(0, MAX_SAVED_LOOKS)
          : [];
        setSavedLooks(normalized);
      }
    } catch {
      setSavedLooks([]);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Server is authoritative once authenticated — same reasoning as
  // FavoritesProvider's equivalent effect (see that file's comment).
  const [isServerSynced, setIsServerSynced] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (status !== "authenticated") {
      setIsServerSynced(true);
      return;
    }
    let cancelled = false;
    fetch("/api/activity/saved-looks")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items?: { id: string; lookId: string; createdAt: string; look: GeneratedLook }[] } | null) => {
        if (cancelled) return;
        if (data?.items) {
          const entries: SavedLookEntry[] = data.items
            .map((i) => ({ id: i.lookId, savedAt: i.createdAt, look: i.look }))
            .slice(0, MAX_SAVED_LOOKS);
          setSavedLooks(entries);
          persist(entries);
        }
        setIsServerSynced(true);
      })
      .catch(() => {
        if (!cancelled) setIsServerSynced(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const persist = useCallback((next: SavedLookEntry[]) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const isSaved = useCallback(
    (lookId: string) => savedLooks.some((entry) => entry.id === lookId),
    [savedLooks],
  );

  const toggleSaved = useCallback(
    (look: GeneratedLook) => {
      const lookId = look.id;
      if (!lookId) return;
      setSavedLooks((current) => {
        const exists = current.some((entry) => entry.id === lookId);
        const next = exists
          ? current.filter((entry) => entry.id !== lookId)
          : [{ id: lookId, savedAt: new Date().toISOString(), look }, ...current].slice(0, MAX_SAVED_LOOKS);
        persist(next);
        if (status === "authenticated") {
          if (exists) syncUnsaveLook(lookId);
          else syncSaveLook(lookId, look);
        }
        return next;
      });
    },
    [persist, status],
  );

  const removeSaved = useCallback(
    (lookId: string) => {
      setSavedLooks((current) => {
        const next = current.filter((entry) => entry.id !== lookId);
        persist(next);
        return next;
      });
      if (status === "authenticated") syncUnsaveLook(lookId);
    },
    [persist, status],
  );

  const value = useMemo(
    () => ({ savedLooks, isLoaded, isServerSynced, isSaved, toggleSaved, removeSaved }),
    [savedLooks, isLoaded, isServerSynced, isSaved, toggleSaved, removeSaved],
  );

  return <SavedLooksContext.Provider value={value}>{children}</SavedLooksContext.Provider>;
}

export function useSavedLooks() {
  const ctx = useContext(SavedLooksContext);
  if (!ctx) throw new Error("useSavedLooks must be used within SavedLooksProvider");
  return ctx;
}
