"use client";

import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/types/product";
import { SaveButton } from "@/components/products/SaveButton";
import type { ViewedProductSource } from "@/lib/products/viewed";
import { useCurrency } from "@/lib/currency/context";
import { formatPrice } from "@/lib/currency/format";
import { useI18n } from "@/lib/i18n";

export function ProductCard({
  product,
  source = "search",
  onOpen,
  imageSizes = "(max-width: 480px) 50vw, 240px",
  preserveScroll = false,
}: {
  product: Product;
  source?: ViewedProductSource;
  /** Optional: fired on click, in addition to normal navigation — lets a
   *  caller (e.g. Explore) log an open_product event without this
   *  component needing to know about the event system. */
  onOpen?: () => void;
  /**
   * The image `sizes` hint MUST match this card's actual rendered
   * width, or next/image fetches a resolution sized for the wrong
   * slot. The default assumes the standard 2-column grid every other
   * caller uses (ProductGrid, overview favorites/recent, look/page.tsx
   * component grid). A caller rendering this card full-width instead
   * (Explore's single-item spotlight look, see ExploreLookCard.tsx)
   * MUST override this — otherwise the card fetches a half-width image
   * and the browser stretches it across the full card, which is
   * exactly what caused the blurry spotlight images.
   */
  imageSizes?: string;
  /** When true, don't reset scroll position on navigation to this
   *  product (see the callers listed above the imageSizes doc for
   *  when this matters). */
  preserveScroll?: boolean;
}) {
  const { currency } = useCurrency();
  const { t } = useI18n();
  // Only ever set on cache-reconstructed products (Overview, Saved,
  // Look pages) — see AvailabilityStatus's comment in types/product.ts.
  // A live-fetched product never has this, so this badge can't
  // accidentally show up on a fresh eBay result.
  const unavailable = product.availabilityStatus != null && product.availabilityStatus !== "AVAILABLE";
  const unavailableLabel = product.availabilityStatus === "SOLD" ? t("product.sold") : t("product.unavailable");

  return (
    <Link
      // eBay item ids contain pipes (v1|110589983217|0) — they must be
      // percent-encoded exactly once here, at the URL boundary.
      href={`/product/${encodeURIComponent(product.id)}?source=${source}`}
      scroll={!preserveScroll}
      onClick={onOpen}
      className="group block rounded-[1.1rem] border border-border bg-surface overflow-hidden transition-shadow hover:shadow-[0_4px_20px_rgba(20,19,15,0.07)]"
    >
      <div className="relative aspect-[4/3] bg-background">
        <Image
          src={product.image}
          alt={product.title}
          fill
          sizes={imageSizes}
          className={`object-cover ${unavailable ? "opacity-60 grayscale" : ""}`}
        />
        {unavailable && (
          <span className="absolute left-2 top-2 rounded-full bg-foreground/90 px-2.5 py-1 text-[10.5px] font-medium text-primary-foreground">
            {unavailableLabel}
          </span>
        )}
        <SaveButton product={product} className="absolute top-2 right-2" />
      </div>
      <div className="p-3">
        <p className="text-[13.5px] font-medium text-foreground leading-snug line-clamp-2">
          {product.title}
        </p>
        <p className="mt-1 text-[12px] text-muted">{product.condition}</p>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-[15px] font-semibold text-foreground">
            {formatPrice(product.price, product.currency, currency, { maximumFractionDigits: 0 })}
          </span>
          {product.seller?.feedbackPercentage != null && (
            <span className="text-[11px] text-muted">
              {product.seller.feedbackPercentage}%
            </span>
          )}
        </div>
        {product.shipping && (
          <p className="mt-0.5 text-[11px] text-muted">
            {product.shipping.cost === 0
              ? "Free shipping"
              : product.shipping.cost != null
                ? `+${formatPrice(product.shipping.cost, product.shipping.currency ?? product.currency, currency, { maximumFractionDigits: 0 })} shipping`
                : null}
          </p>
        )}
      </div>
    </Link>
  );
}
