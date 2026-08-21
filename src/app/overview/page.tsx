"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Bookmark, Eye, Sparkles } from "lucide-react";
import { useLookHistory, type LookHistoryEntry, RECENT_VIEW_LIMIT } from "@/lib/look/history";
import { useSavedLooks, type SavedLookEntry } from "@/lib/look/savedLooks";
import { useViewedProducts } from "@/lib/products/viewed";
import { useFavorites } from "@/lib/products/favorites";
import { ProductCard } from "@/components/products/ProductCard";
import { useI18n } from "@/lib/i18n";
import { useCurrency } from "@/lib/currency/context";
import { formatPrice } from "@/lib/currency/format";
import type { SupportedCurrency } from "@/lib/currency/rates";
import type { Product } from "@/types/product";
import type { GeneratedLook } from "@/types/style";

// The one shape both the local (anonymous) merge and the server
// (authenticated) fetch below get normalized into, so the render path
// underneath doesn't need to know which source it came from.
type RecentlyViewedRenderEntry =
  | { type: "look"; key: string; lookId: string; look: GeneratedLook; timestamp: string }
  | { type: "product"; key: string; product: Product; timestamp: string };

interface ServerRecentlyViewedItem {
  type: "product" | "look";
  id: string;
  lookId?: string;
  timestamp: string;
  product?: Product;
  look?: GeneratedLook;
}

/** Recently Viewed, server-backed for an authenticated user (section
 *  4: "persist it server-side... survive browser refresh and login on
 *  another device"). Anonymous users keep the existing local-merge
 *  behavior in OverviewPage below — this hook only runs the fetch
 *  once status resolves to "authenticated". */
function useServerRecentlyViewed(status: "loading" | "authenticated" | "unauthenticated") {
  const [entries, setEntries] = useState<RecentlyViewedRenderEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    setError(false);
    fetch(`/api/activity/recently-viewed?limit=${RECENT_VIEW_LIMIT}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`http_${res.status}`))))
      .then((data: { items: ServerRecentlyViewedItem[] }) => {
        if (cancelled) return;
        const mapped: RecentlyViewedRenderEntry[] = data.items
          .map((item): RecentlyViewedRenderEntry | null => {
            if (item.type === "look" && item.look && item.lookId) {
              return { type: "look", key: `look-${item.id}`, lookId: item.lookId, look: item.look, timestamp: item.timestamp };
            }
            if (item.type === "product" && item.product) {
              return { type: "product", key: `product-${item.id}`, product: item.product, timestamp: item.timestamp };
            }
            return null;
          })
          .filter((e): e is RecentlyViewedRenderEntry => e !== null);
        setEntries(mapped);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  return { entries, error, isLoaded: entries !== null || error };
}

function LookPreviewCard({
  id,
  look,
  date,
  t,
  currency,
}: {
  id: string;
  look: LookHistoryEntry["look"];
  date: string;
  t: (key: string) => string;
  currency: SupportedCurrency;
}) {
  const { isSaved, toggleSaved } = useSavedLooks();
  const saved = isSaved(id);
  const products = look.components
    .map((component) => component.product)
    .filter(Boolean);

  return (
    <Link
      href={`/look?historyId=${encodeURIComponent(id)}`}
      className="block overflow-hidden rounded-3xl border border-border bg-surface transition-shadow hover:shadow-[0_4px_20px_rgba(20,19,15,0.07)]"
    >
      <div className="relative grid grid-cols-2 gap-px bg-border">
        {/* Shown on every look card here — Saved Looks AND Recently
           Viewed alike (section 2: the two lists are different states,
           not different data) — reflecting and toggling the actual
           saved state, so a look can be saved (or un-saved) directly
           from Recently Viewed, not only from the dedicated Saved
           Looks section. */}
        <button
          type="button"
          aria-pressed={saved}
          aria-label={saved ? "Remove from saved looks" : "Save this look"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSaved(look);
          }}
          className={`absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-sm transition-colors ${
            saved
              ? "border-foreground bg-foreground text-primary-foreground"
              : "border-border bg-surface/90 text-muted"
          }`}
        >
          <Bookmark size={13} fill={saved ? "currentColor" : "none"} />
        </button>
        {products.slice(0, 4).map((product) => (
          <div
            key={product!.id}
            className="relative aspect-square bg-background"
          >
            <Image
              src={product!.image}
              alt=""
              fill
              sizes="240px"
              className="object-cover"
            />
          </div>
        ))}

        {products.length === 0 && (
          <div className="col-span-2 flex aspect-[2/1] items-center justify-center text-muted">
            {t("overview.noProductPreviews")}
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted">
              {t("overview.look")}
            </p>

            <h2 className="mt-1 truncate text-[16px] font-semibold tracking-tight text-foreground">
              {look.title}
            </h2>
          </div>

          {formatPrice(look.totalPrice, look.currency, currency) && (
            <p className="shrink-0 text-[13px] font-semibold text-foreground">
              {formatPrice(look.totalPrice, look.currency, currency)}
            </p>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-[11.5px] text-muted">
          <span>{new Date(date).toLocaleDateString()}</span>

          <span className="flex items-center gap-1">
            {t("overview.open")}
            <ArrowRight size={13} />
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function OverviewPage() {
  const { t } = useI18n();
  const { status } = useSession();

  const { looks, isLoaded: lookLoaded } = useLookHistory();
  const { savedLooks, isLoaded: savedLooksLoaded } = useSavedLooks();
  const { items, isLoaded: viewedLoaded } = useViewedProducts();
  const { products: favorites, isLoaded: favoritesLoaded } = useFavorites();
  const { currency } = useCurrency();

  // ONE combined, chronological "Recently Viewed" stream (looks +
  // products actually opened), newest first. Anonymous users: merged
  // client-side from local view history, same as before. Authenticated
  // users: server-backed (section 4) via useServerRecentlyViewed above
  // — local view history isn't cross-device, so it can't be the source
  // of truth once signed in. Both source arrays are already
  // newest-first and already deduped by their own id
  // (recordViewedLook/recordViewed replace an existing entry in place
  // rather than appending a second one); merging still needs an
  // explicit timestamp sort since interleaving two independently
  // newest-first arrays isn't itself sorted. `viewedSeparately` keeps
  // the existing "actually opened on its own, not merely rendered
  // inside a look" filter — a product only seen as part of a look
  // card doesn't get a redundant entry here on top of that look's own
  // entry. Capped at RECENT_VIEW_LIMIT for DISPLAY only — the
  // underlying stores keep more than this, "View all" just doesn't
  // exist yet for this list (section 3: don't invent it if it's not
  // there).
  const localRecentlyViewed = useMemo<RecentlyViewedRenderEntry[]>(() => {
    const lookEntries: RecentlyViewedRenderEntry[] = looks
      .filter((entry) => Boolean(entry.viewedAt))
      .map((entry) => ({
        type: "look",
        key: `look-${entry.id}`,
        lookId: entry.id,
        look: entry.look,
        timestamp: entry.viewedAt!,
      }));
    const productEntries: RecentlyViewedRenderEntry[] = items
      .filter((item) => item.viewedSeparately)
      .map((entry) => ({
        type: "product",
        key: `product-${entry.product.id}-${entry.viewedAt}`,
        product: entry.product,
        timestamp: entry.viewedAt,
      }));
    return [...lookEntries, ...productEntries]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, RECENT_VIEW_LIMIT);
  }, [looks, items]);

  const server = useServerRecentlyViewed(status);
  const isAuthenticated = status === "authenticated";
  const recentlyViewed = isAuthenticated ? (server.entries ?? []) : localRecentlyViewed;
  const recentlyViewedLoaded = isAuthenticated ? server.isLoaded : lookLoaded && viewedLoaded;
  const recentlyViewedError = isAuthenticated && server.error;

  return (
    <div className="px-5 pt-6 pb-10">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-primary-foreground">
          <Sparkles size={14} />
        </span>

        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            {t("overview.title")}
          </h1>

          <p className="mt-0.5 text-[13px] text-muted">
            {t("overview.subtitle")}
          </p>
        </div>
      </div>

      {/* Favorites */}
      <section className="mt-6">
        <div className="flex items-center gap-2">
          <h2 className="text-[16px] font-semibold text-foreground">
            {t("overview.favorites")}
          </h2>
        </div>

        {favoritesLoaded && favorites.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {favorites.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                source="direct"
              />
            ))}
          </div>
        ) : favoritesLoaded ? (
          <div className="mt-3 rounded-3xl border border-border bg-surface p-5">
            <p className="text-[15px] font-semibold text-foreground">
              {t("overview.noFavorites")}
            </p>

            <p className="mt-1 text-[13px] leading-5 text-muted">
              {t("overview.noFavoritesDescription")}
            </p>
          </div>
        ) : null}
      </section>

      {/* Saved Looks — explicit user action only (useSavedLooks), never
          populated just by opening/viewing a look. See savedLooks.tsx. */}
      <section className="mt-8">
        <div className="flex items-center gap-2">
          <Bookmark size={16} className="text-muted" />
          <h2 className="text-[16px] font-semibold text-foreground">
            {t("overview.savedLooks")}
          </h2>
        </div>

        {savedLooksLoaded && savedLooks.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {savedLooks.map((entry: SavedLookEntry) => (
              <LookPreviewCard
                key={entry.id}
                id={entry.id}
                look={entry.look}
                date={entry.savedAt}
                t={t}
                currency={currency}
              />
            ))}
          </div>
        ) : savedLooksLoaded ? (
          <div className="mt-3 rounded-3xl border border-border bg-surface p-5">
            <p className="text-[15px] font-semibold text-foreground">
              {t("overview.noSavedLooks")}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-muted">
              {t("overview.noSavedLooksDescription")}
            </p>
          </div>
        ) : null}
      </section>

      {/* Recently Viewed — ONE combined, chronological stream of looks
          and products the user actually opened (view history only,
          via useLookHistory/useViewedProducts — never treated as
          "saved", see the Favorites/Saved Looks sections above for
          that). Capped to RECENT_VIEW_LIMIT for display; the
          underlying history keeps more (section 3). */}
      <section className="mt-8">
        <div className="flex items-center gap-2">
          <Eye size={16} className="text-muted" />
          <h2 className="text-[16px] font-semibold text-foreground">
            {t("overview.recentlyViewed")}
          </h2>
        </div>

        {recentlyViewedError ? (
          <div className="mt-3 rounded-3xl border border-border bg-surface p-5">
            <p className="text-[15px] font-semibold text-foreground">{t("overview.recentlyViewedError")}</p>
            <p className="mt-1 text-[13px] leading-5 text-muted">{t("overview.recentlyViewedErrorHint")}</p>
          </div>
        ) : recentlyViewedLoaded && recentlyViewed.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {recentlyViewed.map((entry) =>
              entry.type === "look" ? (
                <LookPreviewCard
                  key={entry.key}
                  id={entry.lookId}
                  look={entry.look}
                  date={entry.timestamp}
                  t={t}
                  currency={currency}
                />
              ) : (
                <ProductCard key={entry.key} product={entry.product} source="direct" />
              ),
            )}
          </div>
        ) : recentlyViewedLoaded ? (
          <div className="mt-3 rounded-3xl border border-border bg-surface p-5">
            <p className="text-[15px] font-semibold text-foreground">
              {t("overview.noRecentlyViewed")}
            </p>

            <p className="mt-1 text-[13px] leading-5 text-muted">
              {t("overview.noRecentlyViewedDescription")}
            </p>

            <Link
              href="/explore"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground"
            >
              {t("overview.exploreLink")}
              <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-3xl bg-surface" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
