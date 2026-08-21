"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { styleProfileStore } from "@/lib/style/store";
import { useStyleProfile } from "@/lib/style/context";

const MERGE_FLAG_PREFIX = "compass.merged.";

function readJson<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Section 10: on sign-in, merge whatever the anonymous session
 *  accumulated locally into the now-authenticated account. Runs once
 *  per (browser, account) pair — guarded by a localStorage flag keyed
 *  on the user id, since a signed-in session persists across reloads
 *  and this must not re-run (and re-POST stale local snapshots) every
 *  time the app mounts. */
export function MergeOnSignIn() {
  const { data: session, status } = useSession();
  const { refreshFromServer } = useStyleProfile();
  const ranForUser = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.id) return;
    const userId = session.user.id;
    const flagKey = `${MERGE_FLAG_PREFIX}${userId}`;
    if (ranForUser.current === userId) return;
    if (window.localStorage.getItem(flagKey)) {
      ranForUser.current = userId;
      return;
    }
    ranForUser.current = userId;

    const profile = styleProfileStore.load();
    const viewed = readJson<{ product?: unknown }>("compass.viewedProducts")
      .map((v) => v.product)
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    const saved = readJson<unknown>("compass.favoriteProducts").filter(Boolean);
    // "compass.savedLooks" (bookmarked/saved looks) — NOT
    // "compass.lookHistory" (recently-VIEWED looks). An earlier
    // version of this file read the wrong key here, which meant
    // signing in was merging your view history into Favorites/Saved
    // Looks instead of your actual saved looks.
    const savedLooksRaw = readJson<{ id?: string; look?: { title?: string; components?: unknown } }>(
      "compass.savedLooks",
    );
    const savedLooks = savedLooksRaw
      .filter((entry): entry is Required<Pick<typeof entry, "id" | "look">> => Boolean(entry.id && entry.look))
      .map((entry) => ({ lookId: entry.id, look: entry.look }));
    const viewedLooksRaw = readJson<{ id?: string; look?: { title?: string; components?: unknown }; viewedAt?: string }>(
      "compass.lookHistory",
    );
    const viewedLooks = viewedLooksRaw
      .filter((entry): entry is Required<Pick<typeof entry, "id" | "look">> & { viewedAt: string } => Boolean(entry.id && entry.look && entry.viewedAt))
      .map((entry) => ({ lookId: entry.id, look: entry.look }));
    const signals = readJson<{ type?: string; productId?: string }>("compass.preferenceSignals");
    const liked = signals.filter((s) => s.type === "like" && s.productId).map((s) => s.productId!);
    const disliked = signals.filter((s) => s.type === "dislike" && s.productId).map((s) => s.productId!);
    const events = readJson<Record<string, unknown>>("compass.events");

    void fetch("/api/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile,
        viewedProducts: viewed,
        savedProducts: saved,
        savedLooks,
        viewedLooks,
        likedProductIds: liked,
        dislikedProductIds: disliked,
        events,
      }),
    })
      .then((res) => {
        if (res.ok) window.localStorage.setItem(flagKey, new Date().toISOString());
      })
      .catch(() => {
        // Leave the flag unset so a future sign-in retries the merge.
        ranForUser.current = null;
      })
      .finally(() => {
        void refreshFromServer();
      });
  }, [status, session?.user?.id, refreshFromServer]);

  return null;
}
