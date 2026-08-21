"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

export type ProductSignal = "like" | "dislike";
type SignalState = ProductSignal | null;

interface ProductSignalsContextValue {
  /** Current signal for a product, or null if neutral/unknown. */
  getSignal: (productId: string) => SignalState;
  /** True while a toggle request for this product is in flight —
   *  callers use this to disable the buttons and prevent a double
   *  submission (section 4). */
  isPending: (productId: string) => boolean;
  /** Batch-restores signal state for a set of product ids the caller
   *  is about to render, skipping any id already known. Safe to call
   *  on every render — it no-ops once ids are loaded, and is a no-op
   *  entirely for guests (section 5: never one request per product;
   *  section 7: never call the API as a guest). */
  ensureLoaded: (productIds: string[]) => void;
  /** Sets productId's signal, or clears it back to neutral if it's
   *  already set to the same value (section 5's toggle-off). Resolves
   *  once the optimistic update has either been confirmed or rolled
   *  back; throws only if the caller wants to react to the failure
   *  beyond the automatic rollback (both current call sites catch and
   *  ignore, relying on the rollback + isPending clearing). */
  toggle: (productId: string, signal: ProductSignal) => Promise<SignalState>;
}

const ProductSignalsContext = createContext<ProductSignalsContextValue | null>(null);

export function ProductSignalsProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";
  const [signals, setSignals] = useState<Record<string, SignalState>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // Tracks which product ids have already been restored (or, for a
  // guest, are already known to have no server state to restore) so
  // ensureLoaded never re-fetches the same id twice in one session.
  const knownRef = useRef<Set<string>>(new Set());
  const loadingBatchRef = useRef<Set<string>>(new Set());

  const getSignal = useCallback((productId: string) => signals[productId] ?? null, [signals]);
  const isPending = useCallback((productId: string) => Boolean(pending[productId]), [pending]);

  const ensureLoaded = useCallback(
    (productIds: string[]) => {
      if (!isAuthenticated) {
        // Guests have nothing to restore — mark as known so a later
        // sign-in-triggered remount can re-check, but no request is
        // ever made while unauthenticated (section 3/7).
        return;
      }
      const missing = productIds.filter((id) => id && !knownRef.current.has(id) && !loadingBatchRef.current.has(id));
      if (missing.length === 0) return;
      for (const id of missing) loadingBatchRef.current.add(id);

      void (async () => {
        try {
          const params = new URLSearchParams({ productIds: missing.join(",") });
          const res = await fetch(`/api/activity/signals?${params.toString()}`);
          if (!res.ok) return;
          const data = (await res.json()) as { signals: Record<string, ProductSignal> };
          setSignals((current) => {
            const next = { ...current };
            for (const id of missing) next[id] = data.signals[id] ?? null;
            return next;
          });
        } catch {
          // Leave these ids unmarked-known so a later ensureLoaded call
          // (e.g. after a transient network error) can retry them.
          for (const id of missing) loadingBatchRef.current.delete(id);
          return;
        }
        for (const id of missing) {
          knownRef.current.add(id);
          loadingBatchRef.current.delete(id);
        }
      })();
    },
    [isAuthenticated],
  );

  const toggle = useCallback(
    async (productId: string, signal: ProductSignal) => {
      const previous = signals[productId] ?? null;
      const optimisticNext: SignalState = previous === signal ? null : signal;

      if (!isAuthenticated) {
        // Guests: session-only client state, never persisted, never
        // hits the API (section 3/7 — no 401 spam, browsing never
        // breaks). Toggle behaves identically, it just doesn't survive
        // a reload.
        setSignals((current) => ({ ...current, [productId]: optimisticNext }));
        return optimisticNext;
      }

      setSignals((current) => ({ ...current, [productId]: optimisticNext }));
      setPending((current) => ({ ...current, [productId]: true }));
      try {
        const res = await fetch("/api/activity/signals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId, signal }),
        });
        if (!res.ok) throw new Error(`signal_http_${res.status}`);
        const data = (await res.json()) as { signal: SignalState };
        // Reconcile with the server's authoritative result rather than
        // trusting the optimistic guess — same shape either way in
        // practice, but this is the single source of truth.
        setSignals((current) => ({ ...current, [productId]: data.signal }));
        knownRef.current.add(productId);
        return data.signal;
      } catch (err) {
        // Roll back the optimistic update on failure (section 4).
        setSignals((current) => ({ ...current, [productId]: previous }));
        throw err;
      } finally {
        setPending((current) => {
          const next = { ...current };
          delete next[productId];
          return next;
        });
      }
    },
    [isAuthenticated, signals],
  );

  const value = useMemo(
    () => ({ getSignal, isPending, ensureLoaded, toggle }),
    [getSignal, isPending, ensureLoaded, toggle],
  );

  return <ProductSignalsContext.Provider value={value}>{children}</ProductSignalsContext.Provider>;
}

export function useProductSignals() {
  const ctx = useContext(ProductSignalsContext);
  if (!ctx) throw new Error("useProductSignals must be used within ProductSignalsProvider");
  return ctx;
}
