"use client";

import { useEffect } from "react";
import { ProductDetails } from "@/components/products/ProductDetails";
import { AskCompass } from "@/components/ai/AskCompass";
import type { Product } from "@/types/product";
import { useViewedProducts, type ViewedProductSource } from "@/lib/products/viewed";

/** Extracted verbatim from app/product/[id]/page.tsx's former local
 *  ProductBody — same behavior, just reusable so the public
 *  /item/[itemId] route (app/item/[itemId]/page.tsx) doesn't need a
 *  second product-detail rendering/view-tracking implementation. */
export function ProductDetailBody({ product, source }: { product: Product; source: ViewedProductSource }) {
  const { recordViewed } = useViewedProducts();

  useEffect(() => {
    recordViewed(product, source);
  }, [product, source, recordViewed]);

  return (
    <>
      <ProductDetails product={product} />
      <div id="ask-compass" className="mt-8 px-5 pb-10 scroll-mt-16">
        <div className="border-t border-border pt-6">
          <AskCompass product={product} />
        </div>
      </div>
    </>
  );
}
