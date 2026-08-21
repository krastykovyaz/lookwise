"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { Product } from "@/types/product";
import { useI18n } from "@/lib/i18n";
import { ProductDetailBody } from "@/components/products/ProductDetailBody";
import { ShareButton } from "@/components/share/ShareButton";
import { ReferralCapture } from "@/components/share/ReferralCapture";

/** Body of the public /item/[itemId] page. The product is already
 *  resolved server-side (see that route's page.tsx, which reuses the
 *  same fetchPublicProductWithFallback call for both this and
 *  generateMetadata), so — unlike /product/[id] — there's no
 *  client-side loading state to handle here; this only wraps
 *  ProductDetailBody with the public page's header/share/attribution
 *  chrome plus an unavailable-listing notice when isLive is false
 *  (section 15 — a shared link outliving the eBay listing shows a
 *  status, not a 404). */
export function PublicItemView({
  product,
  itemId,
  isLive,
}: {
  product: Product;
  itemId: string;
  isLive: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <div>
      <ReferralCapture sourceType="item" sourceId={itemId} />
      <div className="sticky top-0 z-10 flex items-center justify-between bg-background/90 backdrop-blur-sm px-3 py-2.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface border border-border text-foreground"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <ShareButton resolvePath={() => `/item/${encodeURIComponent(itemId)}`} shareTitle={product.title} />
      </div>

      {!isLive && (
        <div className="mx-5 mb-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[12.5px] text-muted">
          {t("product.unavailable")}
        </div>
      )}

      <ProductDetailBody product={product} source="direct" />
    </div>
  );
}
