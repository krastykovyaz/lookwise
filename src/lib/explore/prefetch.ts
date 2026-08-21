// Pure helpers backing the Explore feed's infinite-scroll and
// profile-change behavior. Deliberately framework-free (no DOM, no
// React) so scripts/verify-explore-pagination.ts can exercise the
// exact logic lib/explore/session.tsx and components/explore/
// ExploreFeed.tsx run, without a browser test harness.

import type { BudgetRangeId } from "@/types/style";

/**
 * True once the sentinel (the end of currently loaded content) is
 * within `thresholdViewports` viewport-heights of entering view.
 * `distanceToEndPx` is how far below the current viewport the sentinel
 * still is (e.g. `sentinel.getBoundingClientRect().top`) — 0 or
 * negative means it's already on screen. This is what triggers a
 * background prefetch well before the user reaches the literal bottom.
 */
export function shouldPrefetch(
  distanceToEndPx: number,
  viewportHeightPx: number,
  thresholdViewports = 2.5,
): boolean {
  if (viewportHeightPx <= 0) return false;
  return distanceToEndPx <= viewportHeightPx * thresholdViewports;
}

/**
 * Guards a single async operation against concurrent duplicate runs —
 * the "in-flight lock" behind loadMore/loadInitial/refresh in
 * lib/explore/session.tsx. A call made while one is already in
 * progress is dropped (returns null) rather than queued or restarted,
 * so a fast double-trigger (e.g. a scroll event firing while a
 * prefetch is still resolving) can never issue a second request.
 */
export class SingleFlightGuard {
  private busy = false;

  get isInFlight(): boolean {
    return this.busy;
  }

  async run<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
}

// The slice of the profile that should invalidate an in-progress
// Explore feed the instant it changes — budget and style only, per
// spec (location/brand/color changes don't reset the feed today).
export interface FeedProfileSlice {
  budgetRange: BudgetRangeId | null;
  styleArchetypes: string[];
}

/**
 * Stable string key for a profile slice — order-independent on
 * styleArchetypes (re-selecting the same styles in a different order
 * must NOT look like a change). Two calls with an equivalent slice
 * always produce an identical string, so comparing keys is a safe way
 * to detect a real budget/style change.
 */
export function feedProfileSignature(profile: FeedProfileSlice | null): string {
  return JSON.stringify({
    budgetRange: profile?.budgetRange ?? null,
    styleArchetypes: [...(profile?.styleArchetypes ?? [])].sort(),
  });
}

/**
 * Whether a profile-signature transition should invalidate the current
 * Explore feed (discard items, new session, fresh first page). `null`
 * for either side means "not loaded/known yet" — never treated as a
 * change (that's the initial-hydration case, handled by a normal
 * first load instead of a reset).
 */
export function isFeedInvalidatingChange(prevSignature: string | null, nextSignature: string | null): boolean {
  if (prevSignature === null || nextSignature === null) return false;
  return prevSignature !== nextSignature;
}
