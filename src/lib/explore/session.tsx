"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ExploreFeedItem } from "@/types/explore";
import { useStyleProfile } from "@/lib/style/context";
import { useEvents } from "@/lib/events/context";
import { topLabels, bottomLabels } from "@/lib/events/behavioral";
import { feedProfileSignature, isFeedInvalidatingChange, SingleFlightGuard } from "@/lib/explore/prefetch";

interface ExploreState {
  items: ExploreFeedItem[];
  cursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  sessionId: string;
  startedAt: string;
  scrollPosition: number;
  scrollAnchorId: string | null;
  scrollAnchorOffset: number;
}

interface ExploreFeedContextValue extends ExploreState {
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  setScrollPosition: (value: number) => void;
  setScrollAnchor: (anchorId: string | null, anchorOffset: number) => void;
  captureScrollSnapshot: () => void;
  resumeScrollTracking: () => void;
  getScrollSnapshot: () => { scrollPosition: number; scrollAnchorId: string | null; scrollAnchorOffset: number };
  removeItem: (id: string) => void;
}

const ExploreFeedContext = createContext<ExploreFeedContextValue | null>(null);


function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Dev-only, zero-cost in production: makes "was a new Explore session
// actually created, and why" directly observable in the browser
// console instead of something you have to infer from on-screen
// behavior. initialState() is a useState lazy initializer, so it runs
// exactly once per ExploreFeedProvider mount — and since the provider
// lives in the single root layout (src/app/layout.tsx is the only
// layout.tsx in the app; see verify:explore's "ExploreFeedProvider is
// only ever mounted from the root layout" check), that mount happens
// exactly once per real document load, never on in-app navigation
// (Explore -> Product/Look -> Back). If this line fires while you're
// just clicking around inside the app rather than reloading the
// browser, that's the actual bug to chase — not a hunch, a fact you
// can see directly.
function logSessionCreated(sessionId: string, reason: "mount" | "refresh") {
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    console.info(`[Explore] new session created (${reason}): ${sessionId}`);
  }
}

function initialState(): ExploreState {
  const sessionId = createSessionId();
  logSessionCreated(sessionId, "mount");
  return {
    items: [],
    cursor: null,
    hasMore: true,
    isLoading: false,
    isLoadingMore: false,
    error: null,
    sessionId,
    startedAt: new Date().toISOString(),
    scrollPosition: 0,
    scrollAnchorId: null,
    scrollAnchorOffset: 0,
  };
}

export function ExploreFeedProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ExploreState>(initialState);
  const { profile, isLoaded } = useStyleProfile();
  const { behavioral } = useEvents();

  // The browser's own scroll restoration on back-navigation races with
  // (and can override) the app's own restore logic in ExploreFeed.tsx —
  // this was the "come back to the feed at the top instead of where I
  // left off" bug. Disabling it here means Explore's own restore is the
  // only thing driving scroll position on a back-navigation.
  useEffect(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  // Avoids a stale-closure race if loadMore fires twice before the first
  // response lands (e.g. a fast double-scroll near the sentinel), and is
  // the same guard loadInitial/refresh share — only one request from
  // this provider is ever in flight at a time.
  const guard = useRef(new SingleFlightGuard());
  // null = "profile not hydrated yet" (never treated as a change —
  // see isFeedInvalidatingChange). Set the moment the real profile
  // loads, then compared against on every subsequent profile edit.
  const prevProfileSignature = useRef<string | null>(null);

  // Keep the latest scroll snapshot in refs so scroll/navigation callbacks
  // can update it synchronously without waiting for React state.
  const scrollPositionRef = useRef(0);
  const scrollAnchorIdRef = useRef<string | null>(null);
  const scrollAnchorOffsetRef = useRef(0);


  const buildParams = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (profile?.styleArchetypes?.length) params.set("styles", profile.styleArchetypes.join(","));
      if (profile?.budgetRange) params.set("budget", profile.budgetRange);
      if (profile?.preferredBrands?.length) params.set("prefBrands", profile.preferredBrands.join(","));
      if (profile?.dislikedBrands?.length) params.set("dislBrands", profile.dislikedBrands.join(","));
      if (profile?.preferredColors?.length) params.set("prefColors", profile.preferredColors.join(","));
      if (profile?.dislikedColors?.length) params.set("dislColors", profile.dislikedColors.join(","));
      const topBrands = topLabels(behavioral.brands, 5);
      const bottomBrands = bottomLabels(behavioral.brands, 5);
      const topCategories = topLabels(behavioral.categories, 5);
      const bottomCategories = bottomLabels(behavioral.categories, 5);
      if (topBrands.length) params.set("topBrands", topBrands.join(","));
      if (bottomBrands.length) params.set("bottomBrands", bottomBrands.join(","));
      if (topCategories.length) params.set("topCategories", topCategories.join(","));
      if (bottomCategories.length) params.set("bottomCategories", bottomCategories.join(","));
      if (profile?.location?.latitude != null && profile.location.longitude != null) {
        params.set("lat", String(profile.location.latitude));
        params.set("lon", String(profile.location.longitude));
        if (profile.location.timezone) params.set("tz", profile.location.timezone);
      }
      return params;
    },
    [profile, behavioral],
  );

  const fetchPage = useCallback(
    async (cursor: string | null, mode: "initial" | "more" | "refresh", requestSessionId = state.sessionId) => {
      await guard.current.run(async () => {
        setState((s) => ({
          ...s,
          isLoading: mode !== "more",
          isLoadingMore: mode === "more",
          error: null,
        }));

        try {
          const params = buildParams(cursor);
          params.set("sessionId", requestSessionId);
          const response = await fetch(`/api/explore?${params.toString()}`);
          if (!response.ok) throw new Error(`explore_http_${response.status}`);
          const data: { items: ExploreFeedItem[]; nextCursor: string | null; hasMore: boolean } =
            await response.json();

          setState((s) => ({
            ...s,
            // "more" appends to whatever's already rendered — the UI
            // keeps showing prior pages the whole time this request is
            // in flight, and this is the only place the feed array is
            // ever replaced wholesale (initial/refresh).
            items: mode === "more" ? [...s.items, ...data.items] : data.items,
            cursor: data.nextCursor,
            hasMore: data.hasMore,
            isLoading: false,
            isLoadingMore: false,
            error: null,
          }));
        } catch {
          setState((s) => ({ ...s, isLoading: false, isLoadingMore: false, error: "explore_unavailable" }));
        }
      });
    },
    [buildParams, state.sessionId],
  );

  const loadInitial = useCallback(async () => {
    // Already have a feed for this session (e.g. returning from a
    // product detail page) — don't refetch and lose scroll position.
    if (state.items.length > 0 || guard.current.isInFlight) return;
    await fetchPage(null, "initial");
  }, [fetchPage, state.items.length]);

  const removeItem = useCallback(
    (id: string) => {
      setState((s) => ({ ...s, items: s.items.filter((item) => item.look.id !== id) }));
    },
    [],
  );

  const loadMore = useCallback(async () => {
    if (!state.hasMore || state.isLoadingMore) return;
    await fetchPage(state.cursor, "more");
  }, [fetchPage, state.cursor, state.hasMore, state.isLoadingMore]);

  const refresh = useCallback(async () => {
    const nextSessionId = createSessionId();
    logSessionCreated(nextSessionId, "refresh");
    setState((s) => ({
      ...s,
      sessionId: nextSessionId,
      startedAt: new Date().toISOString(),
      items: [],
      cursor: null,
      hasMore: true,
      scrollPosition: 0,
      scrollAnchorId: null,
      scrollAnchorOffset: 0,
    }));
    await fetchPage(null, "refresh", nextSessionId);
  }, [fetchPage]);

  const setScrollPosition = useCallback((value: number) => {
    scrollPositionRef.current = value;
    setState((current) => ({ ...current, scrollPosition: value }));
  }, []);

  const setScrollAnchor = useCallback((anchorId: string | null, anchorOffset: number) => {
    scrollAnchorIdRef.current = anchorId;
    scrollAnchorOffsetRef.current = anchorOffset;
    setState((current) => ({
      ...current,
      scrollAnchorId: anchorId,
      scrollAnchorOffset: anchorOffset,
    }));
  }, []);

  // Capture synchronously before navigation. This mirrors the Milestone 11
  // behavior that successfully preserved Explore position and avoids a
  // second competing snapshot/freeze system.
  const captureScrollSnapshot = useCallback(() => {
    if (typeof window === "undefined") return;
    const y = window.scrollY;
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-explore-look-id]"));
    let anchorId: string | null = null;
    let anchorOffset = 0;
    let bestTop = -Infinity;

    for (const card of cards) {
      const top = card.getBoundingClientRect().top;
      if (top <= 80 && top > bestTop) {
        anchorId = card.dataset.exploreLookId ?? null;
        anchorOffset = top;
        bestTop = top;
      }
    }

    if (!anchorId && cards.length > 0) {
      const first = cards[0];
      anchorId = first.dataset.exploreLookId ?? null;
      anchorOffset = first.getBoundingClientRect().top;
    }

    scrollPositionRef.current = y;
    scrollAnchorIdRef.current = anchorId;
    scrollAnchorOffsetRef.current = anchorOffset;
    setState((current) => ({
      ...current,
      scrollPosition: y,
      scrollAnchorId: anchorId,
      scrollAnchorOffset: anchorOffset,
    }));
  }, []);

  const resumeScrollTracking = useCallback(() => {}, []);

  const getScrollSnapshot = useCallback(
    () => ({
      scrollPosition: state.scrollPosition,
      scrollAnchorId: state.scrollAnchorId,
      scrollAnchorOffset: state.scrollAnchorOffset,
    }),
    [state.scrollPosition, state.scrollAnchorId, state.scrollAnchorOffset],
  );

  // Budget/style are the only profile fields that immediately
  // invalidate an in-progress Explore feed (section 2). This fires
  // regardless of which page is currently open — the provider lives in
  // the root layout — so a profile edit made from /profile or
  // /look/onboarding still resets Explore in the background, and the
  // user never lands back on /explore to see items generated for the
  // budget/style they just changed away from.
  useEffect(() => {
    if (!isLoaded) return; // wait for profile hydration
    const signature = feedProfileSignature(
      profile ? { budgetRange: profile.budgetRange, styleArchetypes: profile.styleArchetypes } : null,
    );
    const prev = prevProfileSignature.current;
    prevProfileSignature.current = signature;

    if (prev === null) {
      // First time we know the real (hydrated) profile — load with it
      // directly rather than letting an earlier, pre-hydration
      // loadInitial() call (if any) win with unpersonalized params.
      void loadInitial();
    } else if (isFeedInvalidatingChange(prev, signature)) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, profile?.budgetRange, profile?.styleArchetypes]);

  const value = useMemo(
    () => ({
      ...state,
      loadInitial,
      loadMore,
      refresh,
      setScrollPosition,
      setScrollAnchor,
      captureScrollSnapshot,
      resumeScrollTracking,
      getScrollSnapshot,
      removeItem,
    }),
    [
      state,
      loadInitial,
      loadMore,
      refresh,
      setScrollPosition,
      setScrollAnchor,
      captureScrollSnapshot,
      resumeScrollTracking,
      getScrollSnapshot,
      removeItem,
    ],
  );

  return <ExploreFeedContext.Provider value={value}>{children}</ExploreFeedContext.Provider>;
}

export function useExploreFeed() {
  const ctx = useContext(ExploreFeedContext);
  if (!ctx) throw new Error("useExploreFeed must be used within ExploreFeedProvider");
  return ctx;
}
