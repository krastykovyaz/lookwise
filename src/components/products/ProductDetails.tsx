"use client";

import Image from "next/image";
import type { Product } from "@/types/product";
import { Badge } from "@/components/ui/Badge";
import { useI18n } from "@/lib/i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { useCurrency } from "@/lib/currency/context";
import { formatPrice } from "@/lib/currency/format";

interface Insight {
  key: string;
  label: string;
  positive: boolean;
}

/**
 * Every insight here is derived directly from data already on the
 * product — nothing is inferred beyond what the underlying eBay
 * fields support (see Milestone 1 spec: never invent claims like
 * "authentic" the API doesn't back up).
 */
// eBay's Browse API returns a full ISO-8601 timestamp for this field
// (e.g. "2026-09-08T10:00:00.000Z") — a delivery estimate only ever
// needs the date, not a time-of-day that isn't meaningful here. Same
// date-only formatting convention as app/saved/page.tsx and
// app/overview/page.tsx already use for other timestamps.
function formatEstimatedDeliveryDate(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

function buildInsights(product: Product, t: (key: string) => string): Insight[] {
  const insights: Insight[] = [];

  if (product.dealScore != null && product.dealScore >= 70) {
    insights.push({ key: "price", label: t("product.insightGoodPrice"), positive: true });
  }
  if (product.seller?.feedbackPercentage != null && product.seller.feedbackPercentage >= 97) {
    insights.push({ key: "seller", label: t("product.insightStrongSeller"), positive: true });
  }
  const imageCount = 1 + (product.images?.length ?? 0);
  if (imageCount <= 1) {
    insights.push({ key: "photos", label: t("product.insightCheckPhotos"), positive: false });
  }

  return insights;
}

export function ProductDetails({ product }: { product: Product }) {
  const { t } = useI18n();
  const { currency } = useCurrency();
  const insights = buildInsights(product, t);

  const rows: { label: string; value: string | null }[] = [
    { label: t("product.brand"), value: product.brand },
    { label: t("product.seller"), value: product.seller?.username ?? null },
    {
      label: t("product.feedback"),
      value:
        product.seller?.feedbackPercentage != null
          ? `${product.seller.feedbackPercentage}% (${product.seller.feedbackScore ?? "—"})`
          : null,
    },
    { label: t("product.location"), value: product.location },
    {
      label: t("product.shipping"),
      value: product.shipping
        ? product.shipping.cost === 0
          ? "Free"
          : product.shipping.cost != null
            ? formatPrice(product.shipping.cost, product.shipping.currency ?? product.currency, currency, { maximumFractionDigits: 0 })
            : null
        : null,
    },
    {
      label: t("product.estimatedDelivery"),
      value: product.shipping?.estimatedDelivery
        ? formatEstimatedDeliveryDate(product.shipping.estimatedDelivery)
        : null,
    },
    { label: t("product.returns"), value: product.returnPolicy },
  ].filter((row) => row.value);

  const images = Array.from(new Set([product.image, ...(product.images ?? [])].filter(Boolean)));
  const [activeImage, setActiveImage] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const goTo = (index: number) => {
    setActiveImage(Math.max(0, Math.min(index, images.length - 1)));
  };

  const nextImage = () => goTo(activeImage + 1 >= images.length ? 0 : activeImage + 1);
  const previousImage = () => goTo(activeImage - 1 < 0 ? images.length - 1 : activeImage - 1);

  return (
    <div>
      <div
        className="relative aspect-square bg-background overflow-hidden touch-pan-y"
        onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          if (touchStartX.current == null) return;
          const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
          const delta = endX - touchStartX.current;
          touchStartX.current = null;
          if (Math.abs(delta) > 40) delta < 0 ? nextImage() : previousImage();
        }}
      >
        <Image
          key={images[activeImage]}
          src={images[activeImage]}
          alt={product.title}
          fill
          // This hero image is a full-bleed aspect-square block with no
          // max-width wrapper anywhere in the layout — it really does
          // render at the full viewport width on every device, unlike
          // ProductCard's small grid thumbnail. The old fixed
          // `sizes="480px"` told next/image to only ever fetch a
          // ≤480px-wide source, so on any screen wider than that the
          // browser was upscaling an undersized image — visibly worse
          // quality than the same photo shown small in a look/grid card.
          sizes="100vw"
          className="object-cover"
          priority
        />
        {images.length > 1 && (
          <>
            <button type="button" onClick={previousImage} aria-label="Previous image" className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm">
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={nextImage} aria-label="Next image" className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm">
              <ChevronRight size={18} />
            </button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 rounded-full bg-background/65 px-2.5 py-1.5 backdrop-blur-sm">
              {images.map((src, i) => (
                <button
                  key={src + i}
                  type="button"
                  aria-label={`Show image ${i + 1}`}
                  onClick={() => goTo(i)}
                  className={`h-1.5 w-1.5 rounded-full ${i === activeImage ? "bg-foreground" : "bg-foreground/25"}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="px-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-[21px] font-semibold tracking-tight text-foreground leading-snug">
            {product.title}
          </h1>
          {product.dealScore != null && (
            <div className="shrink-0" title={t("product.dealScore")}>
              <Badge tone="positive">{product.dealScore}</Badge>
            </div>
          )}
        </div>
        <p className="mt-1 text-[13px] text-muted">{product.condition}</p>
        <p className="mt-3 text-[26px] font-semibold text-foreground">
          {formatPrice(product.price, product.currency, currency, { maximumFractionDigits: 0 })}
        </p>

        {rows.length > 0 && (
          <dl className="mt-5 divide-y divide-border rounded-2xl border border-border overflow-hidden">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between px-4 py-3 bg-surface"
              >
                <dt className="text-[13px] text-muted">{row.label}</dt>
                <dd className="text-[13px] font-medium text-foreground text-right max-w-[60%] truncate">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {insights.length > 0 && (
          <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
            <p className="text-[12px] font-medium text-muted uppercase tracking-wide">
              {t("product.insightsTitle")}
            </p>
            <ul className="mt-2.5 flex flex-col gap-2">
              {insights.map((insight) => (
                <li key={insight.key} className="flex items-center gap-2 text-[13px]">
                  <span
                    className={insight.positive ? "text-positive" : "text-warning"}
                    aria-hidden="true"
                  >
                    {insight.positive ? "✓" : "⚠"}
                  </span>
                  <span className="text-foreground">{insight.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2.5">
          {product.itemWebUrl && (
            <a
              href={product.itemWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center rounded-full bg-primary text-primary-foreground text-[14px] font-medium py-3.5 transition-transform active:scale-[0.99]"
            >
              {t("product.viewOnEbay")}
            </a>
          )}
          <a
            href="#ask-compass"
            className={`flex w-full items-center justify-center rounded-full text-[14px] font-medium py-3.5 transition-transform active:scale-[0.99] ${
              product.itemWebUrl
                ? "border border-border bg-surface text-foreground"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {t("product.askCompass")}
          </a>
        </div>
      </div>
    </div>
  );
}
