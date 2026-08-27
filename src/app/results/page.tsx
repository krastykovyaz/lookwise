"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, SearchX } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useBuyerResults, REVEAL_STEP } from "@/lib/results";
import { useNavigationState } from "@/lib/navigation/state";
import { ProductGrid } from "@/components/products/ProductGrid";
import { EmptyState } from "@/components/ui/EmptyState";

export default function ResultsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { results, appendItems, revealMore } = useBuyerResults();
  const { saveCurrentPosition } = useNavigationState();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // revealCount lives on `results` itself (see lib/results/index.tsx),
  // not local state, specifically so it survives unmounting when the
  // user opens a product and comes back — see that file's comment for
  // why a local useState here previously broke scroll restoration.
  const revealCount = results?.revealCount ?? REVEAL_STEP;

  // Keep the existing ranking, but show every result returned by Search.
  // Search is not a "top 3" view — it's just revealed gradually rather
  // than all mounted at once.
  const ranked = useMemo(() => {
    const items = results?.items ?? [];
    return [...items].sort((a, b) => (b.dealScore ?? 0) - (a.dealScore ?? 0));
  }, [results?.items]);
  const visible = ranked.slice(0, revealCount);
  const canRevealFetched = revealCount < ranked.length;
  const canFetchMore = !canRevealFetched && Boolean(results?.hasMore);

  const handleShowMore = useCallback(async () => {
    if (revealCount < ranked.length) {
      revealMore();
      return;
    }
    if (!results?.criteria || !results.hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const response = await fetch("/api/buyer/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criteria: results.criteria, offset: results.offset }),
      });
      const data = await response.json();
      if (response.ok) {
        appendItems(data.items, data.offset, data.hasMore);
        revealMore();
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [revealCount, ranked.length, results, isLoadingMore, appendItems, revealMore]);

  // Scroll-triggered loading: once the sentinel below the grid nears the
  // viewport, reveal the next 20 already-fetched items, or (once those run
  // out) fetch the next eBay page. Re-armed whenever there's more to show
  // and no fetch is already in flight.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !(canRevealFetched || canFetchMore) || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) handleShowMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canRevealFetched, canFetchMore, isLoadingMore, handleShowMore]);

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center bg-background/90 backdrop-blur-sm px-3 py-2.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface border border-border text-foreground"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
      </div>

      <div className="px-5">
        {!results ? (
          <EmptyState
            icon={SearchX}
            title={t("results.noResultsTitle")}
            hint={t("results.backToSearch")}
          />
        ) : ranked.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={t("results.noResultsTitle")}
            hint={`${t("results.noResultsBody")} ${t("results.noResultsHint")}`}
          />
        ) : (
          <>
            <h1 className="text-[21px] font-semibold tracking-tight text-foreground leading-snug">
              {t("results.foundPrefix")} {results?.total ?? ranked.length} {t("results.foundOptions")}
            </h1>
            <p className="mt-1 text-[13px] text-muted">{t("results.rankedBy")}</p>

            <div className="mt-4">
              <ProductGrid products={visible} onOpen={saveCurrentPosition} />
            </div>

            {(canRevealFetched || canFetchMore) && (
              <div ref={sentinelRef} className="flex justify-center py-6">
                {isLoadingMore && <p className="text-[13px] text-muted">{t("results.loadingMore")}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
