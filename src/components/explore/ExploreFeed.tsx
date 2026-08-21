"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Compass, RotateCw } from "lucide-react";
import type { ExploreFeedItem } from "@/types/explore";
import { useExploreFeed } from "@/lib/explore/session";
import { useStyleProfile } from "@/lib/style/context";
import { useEvents } from "@/lib/events/context";
import { useLookHistory } from "@/lib/look/history";
import { useSavedLooks } from "@/lib/look/savedLooks";
import { usePreferenceSignals } from "@/lib/style/preferences";
import { useProductSignals } from "@/lib/style/productSignals";
import { ExploreLookCard } from "@/components/explore/ExploreLookCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { useI18n } from "@/lib/i18n";
import { shouldPrefetch } from "@/lib/explore/prefetch";

// Batch size the sentinel is placed relative to — trigger a fetch a
// little before the user actually hits the bottom, so the next batch is
// ready before they get there (section 13).
const LOW_WATERMARK = 3;

// Prefetch the next page ~2–3 viewport heights before the sentinel (the
// end of currently loaded content) would actually enter view — never
// wait for the user to hit the absolute bottom. Expressed as a
// multiple of viewport height (rather than a fixed px value) so it
// scales correctly across phone/tablet/desktop instead of being too
// small on a tall screen or too large on a short one.
const PREFETCH_VIEWPORTS = 2.5;

function lookIdOf(item: ExploreFeedItem): string {
  return item.look.id ?? "";
}

function primaryProductOf(item: ExploreFeedItem) {
  return item.look.components[0]?.product ?? null;
}

/** Which currently-rendered look card should be treated as the "you
 *  are here" anchor, given the current scroll position — the card
 *  whose top is closest to (but not below) the viewport's upper edge.
 *  Pulled out of the component so it can be called both from an
 *  explicit "about to navigate away" capture (captureFeedPosition
 *  below) and from a plain scroll listener (so leaving Explore via a
 *  bottom-nav tab, not just a product/look click, still has a fresh
 *  position to restore to — see the scroll-tracking effect). */
function computeFeedAnchor(): { anchorId: string | null; anchorOffset: number } {
  const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-explore-look-id]"));
  let best: HTMLElement | null = null;
  let bestTop = -Infinity;
  for (const card of cards) {
    const top = card.getBoundingClientRect().top;
    if (top <= 80 && top > bestTop) {
      best = card;
      bestTop = top;
    }
  }
  if (!best && cards.length > 0) {
    best = cards[0];
    bestTop = best.getBoundingClientRect().top;
  }
  return best ? { anchorId: best.dataset.exploreLookId ?? null, anchorOffset: bestTop } : { anchorId: null, anchorOffset: 0 };
}

export function ExploreFeed() {
  const { t } = useI18n();
  const router = useRouter();
  const {
    items,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    scrollPosition,
    scrollAnchorId,
    scrollAnchorOffset,
    loadMore,
    refresh,
    removeItem,
    setScrollPosition,
    setScrollAnchor,
    captureScrollSnapshot,
    resumeScrollTracking,
    getScrollSnapshot,
  } = useExploreFeed();
  // isLoaded gates the initial-loading skeleton below — the feed
  // provider (lib/explore/session.tsx) waits for the profile to
  // hydrate before firing the first request, so items/isLoading both
  // stay at their initial falsy values for a moment on a fresh mount;
  // without this the empty-state briefly flashes before that request
  // starts.
  const { isLoaded: isProfileLoaded } = useStyleProfile();
  const { record: recordEvent } = useEvents();
  const { recordViewedLook } = useLookHistory();
  const { isSaved, toggleSaved } = useSavedLooks();
  const { record: recordSignal } = usePreferenceSignals();
  const { getSignal, isPending: isSignalPending, ensureLoaded, toggle } = useProductSignals();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);

  // Preserve scroll position across a trip to a product detail page and
  // back (section 20) — the feed provider survives navigation, this just
  // restores where the user was looking on remount. useLayoutEffect (not
  // useEffect) so this runs before the browser paints the remounted
  // list, avoiding a visible flash at the top before jumping down.
  //
  // A single requestAnimationFrame isn't reliable here: the previously
  // loaded items (already in state — nothing needs refetching) still
  // have to lay out again after remount, and on a slower device that
  // can take more than one frame. Restoring before the page is tall
  // enough would just clamp to whatever's currently rendered, which
  // looks identical to "reset to the top" — exactly the bug being
  // fixed. So this polls layout height for a few frames before jumping,
  // and gives up gracefully (scrolls as far as it can) rather than
  // spinning forever if something's actually wrong.
  useLayoutEffect(() => {
    if (restoredRef.current || items.length === 0) return;
    restoredRef.current = true;

    // Milestone 11 restoration logic: use the actual Explore card anchor,
    // with raw scrollY only as a fallback. The Explore provider survives
    // client-side navigation, so this state remains available when the feed
    // remounts.
    const targetId = scrollAnchorId;
    const targetOffset = scrollAnchorOffset;
    let attempts = 0;

    const tryRestore = () => {
      attempts++;

      if (targetId) {
        const escaped =
          typeof CSS !== "undefined" && CSS.escape
            ? CSS.escape(targetId)
            : targetId.replace(/"/g, '\\\"');
        const target = document.querySelector<HTMLElement>(
          `[data-explore-look-id="${escaped}"]`,
        );

        if (target) {
          const delta = target.getBoundingClientRect().top - targetOffset;
          window.scrollBy(0, delta);
          return;
        }
      }

      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );

      if (maxScroll >= scrollPosition || attempts >= 20) {
        window.scrollTo(0, Math.min(scrollPosition, maxScroll));
      } else {
        requestAnimationFrame(tryRestore);
      }
    };

    requestAnimationFrame(tryRestore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);


  useEffect(() => {
    const onScroll = () => setScrollPosition(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [setScrollPosition]);


  // True background prefetching (section 3/4): while there's still more
  // to fetch and nothing is already in flight, check how far the
  // sentinel (end of currently rendered content) is from the viewport
  // and start the next request as soon as it's within ~2–3 viewport
  // heights — well before the user could ever scroll to the literal
  // bottom. loadMore() itself is guarded by a single-flight lock (see
  // SingleFlightGuard in lib/explore/prefetch.ts), so firing this check
  // from several listeners at once can never issue duplicate requests.
  //
  // The effect re-runs whenever `items.length` changes, so the moment a
  // prefetched page is appended it immediately re-checks and — if the
  // sentinel (now further down the now-longer page) is still within
  // range — starts prefetching the *following* page right away, without
  // waiting for another scroll event. This is what keeps a chain of
  // prefetches going on a short page / tall viewport instead of
  // stalling after one page.
  useEffect(() => {
    if (!hasMore || isLoadingMore) return;
    let ticking = false;
    const check = () => {
      const node = sentinelRef.current;
      if (!node) return;
      const distanceToEnd = node.getBoundingClientRect().top;
      if (shouldPrefetch(distanceToEnd, window.innerHeight, PREFETCH_VIEWPORTS)) void loadMore();
    };
    const onScrollOrResize = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        check();
      });
    };
    check(); // covers the immediate re-check on append, and a short first page in a tall viewport
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [items.length, hasMore, isLoadingMore, loadMore]);

  // If items got trimmed below the watermark by a Change action, top the
  // feed back up rather than waiting for the user to scroll further.
  useEffect(() => {
    if (items.length > 0 && items.length < LOW_WATERMARK && hasMore && !isLoadingMore) {
      void loadMore();
    }
  }, [items.length, hasMore, isLoadingMore, loadMore]);

  // Bookmark ("Save") active state now comes from the explicit
  // saved-looks store, not view history — see savedLooks.tsx. Viewing
  // a look (handleOpenLook below) never affects this.

  // Batch-restore persisted like/dislike state (section 5) for every
  // primary product currently rendered, in one request per new batch
  // of items — ensureLoaded itself skips ids already known, so this
  // effect firing again after loadMore() appends a page only fetches
  // the newly-appended items' ids.
  useEffect(() => {
    const ids = items.map((item) => primaryProductOf(item)?.id).filter((id): id is string => Boolean(id));
    if (ids.length > 0) ensureLoaded(ids);
  }, [items, ensureLoaded]);

  const handleImpression = useCallback(
    (lookId: string) => recordEvent({ type: "impression", lookId, source: "explore" }),
    [recordEvent],
  );

  const captureFeedPosition = useCallback(() => {
    // Freeze the provider before navigation can cause a transient scrollY=0.
    // The provider computes/writes the snapshot synchronously, so neither
    // Next navigation nor the scroll listener can overwrite it afterwards.
    captureScrollSnapshot();
    return getScrollSnapshot();
  }, [captureScrollSnapshot, getScrollSnapshot]);

  const handleOpenProduct = useCallback(
    (lookId: string, productId: string, category: string | null, brand: string | null) => {
      // Next can reset document.scrollY as soon as navigation starts.
      // Capture the position synchronously, before that happens.
      captureFeedPosition();
      recordEvent({ type: "open_product", lookId, productId, category, brand, source: "explore" });
    },
    [captureFeedPosition, recordEvent],
  );

  const handleOpenLook = useCallback(
    (item: (typeof items)[number]) => {
      const lookId = lookIdOf(item);
      // Capture before router.push(): Next/browser navigation may reset
      // scrollY to 0 while the Explore component is being unmounted.
      captureFeedPosition();
      recordEvent({ type: "open_look", lookId, source: "explore" });
      // View-only — this must never mark the look as saved (section 2:
      // "opening/viewing a look only records a viewed event/history
      // item"). See savedLooks.tsx / handleSave below for the explicit
      // Save action.
      recordViewedLook(item.look);
      router.push(`/look?historyId=${encodeURIComponent(lookId)}`, { scroll: false });
    },
    [captureFeedPosition, recordEvent, router, recordViewedLook],
  );

  const handleLike = useCallback(
    (item: (typeof items)[number]) => {
      recordEvent({ type: "like", lookId: item.look.id, source: "explore" });
      const primary = primaryProductOf(item);
      if (primary) {
        void toggle(primary.id, "like")
          .then((resulting) => {
            // Only feed the AI-context log on a genuine like, not a
            // toggle-off (section 6) — bridges into the existing
            // preference-signal store so the AI look generator
            // (lib/look) keeps benefiting from Explore activity too.
            if (resulting === "like") {
              for (const component of item.look.components) {
                if (component.product) recordSignal("like", component.product);
              }
            }
          })
          .catch(() => {
            // Rollback already happened inside toggle(); this just
            // prevents an unhandled promise rejection from reaching
            // the console/browser.
          });
      } else {
        for (const component of item.look.components) {
          if (component.product) recordSignal("like", component.product);
        }
      }
    },
    [recordEvent, recordSignal, toggle],
  );

  const handleDislike = useCallback(
    (item: (typeof items)[number]) => {
      recordEvent({ type: "dislike", lookId: item.look.id, source: "explore" });
      const primary = primaryProductOf(item);
      if (primary) {
        void toggle(primary.id, "dislike")
          .then((resulting) => {
            if (resulting === "dislike") {
              for (const component of item.look.components) {
                if (component.product) recordSignal("dislike", component.product);
              }
            }
          })
          .catch(() => {
            // Rollback already happened inside toggle().
          });
      } else {
        for (const component of item.look.components) {
          if (component.product) recordSignal("dislike", component.product);
        }
      }
    },
    [recordEvent, recordSignal, toggle],
  );

  const handleSave = useCallback(
    (item: (typeof items)[number]) => {
      const alreadySaved = isSaved(lookIdOf(item));
      recordEvent({ type: alreadySaved ? "unsave" : "save", lookId: lookIdOf(item), source: "explore" });
      // The only place that writes to the explicit saved-looks store —
      // toggles on/off, backed by saved_look for authenticated users
      // (section 2).
      toggleSaved(item.look);
    },
    [recordEvent, isSaved, toggleSaved],
  );

  const handleChange = useCallback(
    (item: (typeof items)[number]) => {
      recordEvent({ type: "change_item", lookId: lookIdOf(item), source: "explore" });
      removeItem(lookIdOf(item));
    },
    [recordEvent, removeItem],
  );

  if ((isLoading || !isProfileLoaded) && items.length === 0) {
    return (
      <div className="px-5 pt-2 pb-6 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded-2xl bg-surface border border-border" />
        ))}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="px-5">
        <EmptyState icon={Compass} title={t("explore.errorTitle")} hint={t("explore.errorHint")} />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2.5 text-[13px] font-medium text-primary-foreground"
          >
            <RotateCw size={14} />
            {t("explore.refresh")}
          </button>
        </div>
      </div>
    );
  }

  if (!isLoading && items.length === 0) {
    return (
      <div className="px-5">
        <EmptyState icon={Compass} title={t("explore.emptyTitle")} hint={t("explore.emptyHint")} />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2.5 text-[13px] font-medium text-primary-foreground"
          >
            <RotateCw size={14} />
            {t("explore.refresh")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-2 pb-10 space-y-3">
      {items.map((item, index) => (
        <ExploreLookCard
          // The recycle-when-exhausted fallback (engine.ts) can now
          // legitimately reuse a look.id that's already in this
          // client-side list (recycled items append, they never
          // replace) — a plain look.id key would collide and trigger
          // React's duplicate-key warning/instability. The index is
          // safe here since items only ever append or get filtered out
          // by handleChange, never reorder.
          key={`${lookIdOf(item)}-${index}`}
          item={item}
          isSaved={isSaved(lookIdOf(item))}
          onImpression={() => handleImpression(lookIdOf(item))}
          onOpenProduct={(productId, category, brand) =>
            handleOpenProduct(lookIdOf(item), productId, category, brand)
          }
          onOpenLook={() => handleOpenLook(item)}
          onLike={() => handleLike(item)}
          onDislike={() => handleDislike(item)}
          likeActive={(() => {
            const p = primaryProductOf(item);
            return p ? getSignal(p.id) === "like" : false;
          })()}
          dislikeActive={(() => {
            const p = primaryProductOf(item);
            return p ? getSignal(p.id) === "dislike" : false;
          })()}
          feedbackPending={(() => {
            const p = primaryProductOf(item);
            return p ? isSignalPending(p.id) : false;
          })()}
          onSave={() => handleSave(item)}
          onChange={() => handleChange(item)}
        />
      ))}
      <div ref={sentinelRef} className="h-4" />
      {isLoadingMore && <div className="h-40 animate-pulse rounded-2xl bg-surface border border-border" />}
      {!hasMore && items.length > 0 && (
        <p className="pt-2 text-center text-[12px] text-muted">{t("explore.caughtUp")}</p>
      )}
    </div>
  );
}
