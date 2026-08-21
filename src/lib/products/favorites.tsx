"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { Product } from "@/types/product";
import { syncSaveProduct, syncUnsaveProduct } from "@/lib/db/clientSync";

const STORAGE_KEY = "compass.favoriteProducts";
const MAX_FAVORITES = 100;

interface FavoritesContextValue {
  products: Product[];
  isLoaded: boolean;
  /** True once the server-authoritative check has settled for an
   *  authenticated user (fetched or failed) — false for the entire
   *  window where an authenticated user's local cache might still be
   *  stale/empty relative to the server. Always true immediately for
   *  an anonymous session (nothing to wait for). Callers that need to
   *  distinguish "actually empty" from "haven't checked the server
   *  yet" (the Saved page) should gate on this, not just isLoaded. */
  isServerSynced: boolean;
  isFavorite: (productId: string) => boolean;
  toggleFavorite: (product: Product) => void;
  removeFavorite: (productId: string) => void;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const { status } = useSession();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Product[];
        setProducts(Array.isArray(parsed) ? parsed.slice(0, MAX_FAVORITES) : []);
      }
    } catch {
      setProducts([]);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Server is authoritative once authenticated (section: "Favorites
  // must be server-authoritative... unlike only relying on
  // React/local state"). This overwrites whatever the localStorage
  // read above produced — including on a brand-new browser/device
  // with no local cache at all — so isFavorite() (used for every
  // save-button's active state throughout the app, not just the Saved
  // page) is correct immediately after sign-in, not just on the Saved
  // page itself.
  const [isServerSynced, setIsServerSynced] = useState(false);

  useEffect(() => {
    if (status === "loading") return; // wait for auth to resolve before deciding
    if (status !== "authenticated") {
      setIsServerSynced(true); // nothing to sync for an anonymous session
      return;
    }
    let cancelled = false;
    fetch("/api/activity/saved-products")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items?: { product: Product }[] } | null) => {
        if (cancelled) return;
        if (data?.items) {
          const items = data.items.map((i) => i.product).slice(0, MAX_FAVORITES);
          setProducts(items);
          persist(items);
        }
        setIsServerSynced(true);
      })
      .catch(() => {
        // Keep whatever local state already has — best-effort refresh —
        // but still unblock callers waiting on isServerSynced.
        if (!cancelled) setIsServerSynced(true);
      });
    return () => {
      cancelled = true;
    };
    // persist is a stable useCallback ([]) deps — safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const persist = useCallback((next: Product[]) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const isFavorite = useCallback(
    (productId: string) => products.some((product) => product.id === productId),
    [products],
  );

  const toggleFavorite = useCallback(
    (product: Product) => {
      setProducts((current) => {
        const exists = current.some((item) => item.id === product.id);
        const next = exists
          ? current.filter((item) => item.id !== product.id)
          : [product, ...current].slice(0, MAX_FAVORITES);
        persist(next);
        if (status === "authenticated") {
          if (exists) syncUnsaveProduct(product.id);
          else syncSaveProduct(product);
        }
        return next;
      });
    },
    [persist, status],
  );

  const removeFavorite = useCallback(
    (productId: string) => {
      setProducts((current) => {
        const next = current.filter((product) => product.id !== productId);
        persist(next);
        return next;
      });
      if (status === "authenticated") syncUnsaveProduct(productId);
    },
    [persist, status],
  );

  const value = useMemo(
    () => ({ products, isLoaded, isServerSynced, isFavorite, toggleFavorite, removeFavorite }),
    [products, isLoaded, isServerSynced, isFavorite, toggleFavorite, removeFavorite],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider");
  return ctx;
}
