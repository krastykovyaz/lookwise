"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { Product } from "@/types/product";
import { syncViewedProduct } from "@/lib/db/clientSync";

const STORAGE_KEY = "compass.viewedProducts";
const MAX_VIEWED = 10;

export type ViewedProductSource = "search" | "look" | "direct";

export interface ViewedProduct {
  product: Product;
  viewedAt: string;
  source: ViewedProductSource;
  viewedSeparately: boolean;
}

interface ViewedProductsContextValue {
  items: ViewedProduct[];
  isLoaded: boolean;
  recordViewed: (product: Product, source?: ViewedProductSource) => void;
  clearViewed: () => void;
}

const ViewedProductsContext = createContext<ViewedProductsContextValue | null>(null);

export function ViewedProductsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ViewedProduct[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const { status } = useSession();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ViewedProduct>[];
        const normalized = Array.isArray(parsed)
          ? parsed
              .filter((item) => item && item.product)
              .map((item) => ({
                product: item.product!,
                viewedAt: item.viewedAt ?? new Date().toISOString(),
                source: item.source ?? "direct",
                viewedSeparately: item.viewedSeparately ?? item.source !== "look",
              }))
          : [];
        setItems(normalized.slice(0, MAX_VIEWED));
      }
    } catch {
      setItems([]);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const recordViewed = useCallback((product: Product, source: ViewedProductSource = "direct") => {
    setItems((current) => {
      const previous = current.find((item) => item.product.id === product.id);
      const entry: ViewedProduct = {
        product,
        viewedAt: new Date().toISOString(),
        source,
        viewedSeparately: Boolean(previous?.viewedSeparately || source !== "look"),
      };
      const next = [entry, ...current.filter((item) => item.product.id !== product.id)].slice(0, MAX_VIEWED);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    if (status === "authenticated") syncViewedProduct(product);
  }, [status]);

  const clearViewed = useCallback(() => {
    setItems([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const value = useMemo(
    () => ({ items, isLoaded, recordViewed, clearViewed }),
    [items, isLoaded, recordViewed, clearViewed],
  );

  return <ViewedProductsContext.Provider value={value}>{children}</ViewedProductsContext.Provider>;
}

export function useViewedProducts() {
  const ctx = useContext(ViewedProductsContext);
  if (!ctx) throw new Error("useViewedProducts must be used within ViewedProductsProvider");
  return ctx;
}
