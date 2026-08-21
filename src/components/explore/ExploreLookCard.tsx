"use client";

import { useEffect, useRef, useState } from "react";
import { ThumbsDown, ThumbsUp, RefreshCw, Bookmark } from "lucide-react";
import type { ExploreFeedItem } from "@/types/explore";
import { ProductCard } from "@/components/products/ProductCard";
import { ShareButton } from "@/components/share/ShareButton";
import { lookSnapshot } from "@/lib/db/clientSync";
import { useI18n } from "@/lib/i18n";
import { useCurrency } from "@/lib/currency/context";
import { formatPrice } from "@/lib/currency/format";

const ROLE_LABEL_KEY: Record<string, string> = {
  top: "explore.role.top",
  bottom: "explore.role.bottom",
  outerwear: "explore.role.outerwear",
  footwear: "explore.role.footwear",
  accessory: "explore.role.accessory",
  other: "explore.role.other",
};

export function ExploreLookCard({
  item,
  isSaved,
  onImpression,
  onOpenProduct,
  onOpenLook,
  onLike,
  onDislike,
  likeActive = false,
  dislikeActive = false,
  feedbackPending = false,
  onSave,
  onChange,
}: {
  item: ExploreFeedItem;
  isSaved: boolean;
  onImpression: () => void;
  onOpenProduct: (productId: string, category: string | null, brand: string | null) => void;
  onOpenLook: () => void;
  onLike: () => void;
  onDislike: () => void;
  likeActive?: boolean;
  dislikeActive?: boolean;
  feedbackPending?: boolean;
  onSave: () => void;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const { currency } = useCurrency();
  const { look } = item;
  const primaryProduct = look.components[0]?.product ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const [hasFiredImpression, setHasFiredImpression] = useState(false);
  // Caches the on-demand public snapshot id for a multi-item look (see
  // /api/look/share) so re-tapping Share on the same card never
  // materializes a second snapshot row. One card = one look for this
  // component's lifetime, so a plain ref (not a map) is enough — see
  // look/page.tsx's shareIdsRef for the equivalent where a single page
  // instance can show several different looks over time.
  const shareIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ref.current || hasFiredImpression) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setHasFiredImpression(true);
          onImpression();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
    // onImpression is stable enough within a card's lifetime; re-running
    // this on every render would attach/detach the observer constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFiredImpression]);

  return (
    <div
      ref={ref}
      data-explore-look-id={look.id}
      className="rounded-2xl border border-border bg-surface p-4"
    >
      <div className="flex items-end justify-between gap-3">
        <h3 className="text-[16px] font-semibold tracking-tight text-foreground">{look.title}</h3>
        {look.totalPrice != null && (
          <p className="shrink-0 text-[14px] font-semibold text-foreground">
            {formatPrice(look.totalPrice, look.currency, currency, { maximumFractionDigits: 0 })}
          </p>
        )}
      </div>

      {look.styleNotes && look.styleNotes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {look.styleNotes.map((note) => (
            <span key={note} className="rounded-full bg-background px-2.5 py-1 text-[11px] text-muted">
              {note}
            </span>
          ))}
        </div>
      )}

      <div className={`mt-3 grid gap-2.5 ${look.components.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {look.components.map((component, index) => (
          <div key={`${component.role}-${component.productId ?? index}`}>
            {look.components.length > 1 && (
              <p className="mb-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                {t(ROLE_LABEL_KEY[component.role] ?? "explore.role.other")}
              </p>
            )}
            {component.product && (
              <ProductCard
                product={component.product}
                source="search"
                onOpen={() => onOpenProduct(component.product!.id, component.product!.category, component.product!.brand)}
                // The 2-item look grid above (grid-cols-2) matches
                // ProductCard's default 50vw sizing hint, but a
                // single-item "spotlight" look (grid-cols-1) renders
                // this card at close to the full card width instead —
                // without this override, next/image fetches a
                // half-width image for it and the browser stretches it
                // to fill the full width, which is what caused the
                // blurry spotlight photos. The exact width is viewport
                // minus the feed list's px-5 (40px) and this card's own
                // p-4 (32px) padding — 72px total.
                imageSizes={look.components.length === 1 ? "(max-width: 480px) calc(100vw - 72px), 480px" : undefined}
                preserveScroll
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onChange}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-2 text-[11.5px] font-medium text-foreground"
        >
          <RefreshCw size={13} />
          {t("explore.action.change")}
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={t("explore.action.like")}
            aria-pressed={likeActive}
            disabled={feedbackPending}
            onClick={(e) => {
              e.stopPropagation();
              onLike();
            }}
            className={`flex h-9 w-9 items-center justify-center rounded-full border disabled:opacity-50 ${
              likeActive ? "border-foreground bg-foreground text-primary-foreground" : "border-border bg-background text-muted hover:text-foreground"
            }`}
          >
            <ThumbsUp size={15} fill={likeActive ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            aria-label={t("explore.action.dislike")}
            aria-pressed={dislikeActive}
            disabled={feedbackPending}
            onClick={(e) => {
              e.stopPropagation();
              onDislike();
            }}
            className={`flex h-9 w-9 items-center justify-center rounded-full border disabled:opacity-50 ${
              dislikeActive ? "border-foreground bg-foreground text-primary-foreground" : "border-border bg-background text-muted hover:text-foreground"
            }`}
          >
            <ThumbsDown size={15} fill={dislikeActive ? "currentColor" : "none"} />
          </button>
          {primaryProduct && (
            <button
              type="button"
              onClick={onOpenLook}
              aria-label={t("explore.action.open")}
              className="flex h-9 min-w-9 items-center justify-center rounded-full border border-border bg-background px-2 text-muted hover:text-foreground"
            >
              <span className="text-[11px] font-medium">{t("explore.action.open")}</span>
            </button>
          )}
          <button
            type="button"
            aria-label={t("explore.action.save")}
            onClick={onSave}
            className={`flex h-9 w-9 items-center justify-center rounded-full border ${
              isSaved ? "border-foreground bg-foreground text-primary-foreground" : "border-border bg-background text-muted hover:text-foreground"
            }`}
          >
            <Bookmark size={15} fill={isSaved ? "currentColor" : "none"} />
          </button>
          {/* Looks and single-item "spotlight" cards both share this
           *  row (Explore has no separate standalone-item card type —
           *  see types/explore.ts) — a single-component look shares as
           *  its item link directly rather than a 1-item look page,
           *  which is the more useful link for that case. */}
          <ShareButton
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted transition-colors hover:text-foreground disabled:opacity-50"
            resolvePath={async () => {
              if (look.components.length === 1 && primaryProduct) {
                return `/item/${encodeURIComponent(primaryProduct.id)}`;
              }
              if (shareIdRef.current) return `/look/${shareIdRef.current}`;
              try {
                const res = await fetch("/api/look/share", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ look: lookSnapshot(look) }),
                });
                if (!res.ok) return null;
                const data = (await res.json()) as { lookId?: string };
                if (!data.lookId) return null;
                shareIdRef.current = data.lookId;
                return `/look/${data.lookId}`;
              } catch {
                return null;
              }
            }}
            shareTitle={look.title}
          />
        </div>
      </div>
    </div>
  );
}
