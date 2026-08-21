"use client";

import { use, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getMockProductById } from "@/lib/mock/products";
import { useBuyerResults } from "@/lib/results";
import { useI18n } from "@/lib/i18n";
import { FetchedProduct } from "@/components/products/FetchedProduct";
import { ProductDetailBody } from "@/components/products/ProductDetailBody";
import { ShareButton } from "@/components/share/ShareButton";
import type { Product } from "@/types/product";
import type { ViewedProductSource } from "@/lib/products/viewed";

export default function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t } = useI18n();
  const router = useRouter();
  const { getById } = useBuyerResults();

  // Resolution order: last search results (fastest, no network) ->
  // static Discover mock data. Both are synchronous, so they're derived
  // during render — no effect/fetch needed for either.
  const syncProduct = useMemo<Product | undefined>(() => {
    return getById(id) ?? (id.startsWith("mock-") ? getMockProductById(id) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const searchParams = useSearchParams();
  const source = parseViewedSource(searchParams.get("source"));

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between bg-background/90 backdrop-blur-sm px-3 py-2.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface border border-border text-foreground"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <ShareButton
          resolvePath={() => `/item/${encodeURIComponent(id)}`}
          shareTitle={syncProduct?.title ?? "Lookwise"}
        />
      </div>

      {syncProduct ? (
        <ProductDetailBody product={syncProduct} source={source} />
      ) : (
        // Live eBay lookup for direct links / refreshes where the
        // in-memory results context and mock data don't have this id.
        // Keyed by id so its internal fetch state fully resets on
        // navigation between two different fetched products.
        <FetchedProduct key={id} id={id}>
          {(product) => (
            <ProductDetailBody product={product} source={source} />
          )}
        </FetchedProduct>
      )}
    </div>
  );
}

function parseViewedSource(value: string | null): ViewedProductSource {
  return value === "look" || value === "direct" ? value : "search";
}
