"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { SUPPORTED_CURRENCIES, isSupportedCurrency, type SupportedCurrency } from "@/lib/currency/rates";

const STORAGE_KEY = "compass.currency";
const DEFAULT_CURRENCY: SupportedCurrency = "EUR";

// Presentation-only preference (section 6): selecting a display
// currency here never touches eBay search/price filters, which stay
// in whatever currency the eBay API expects (see
// lib/ebay/filters.ts's DEFAULT_CURRENCY). The two are deliberately
// decoupled — this provider only affects how already-fetched prices
// are formatted for display (lib/currency/format.ts).

interface CurrencyContextValue {
  currency: SupportedCurrency;
  isLoaded: boolean;
  setCurrency: (currency: SupportedCurrency) => void;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";
  const [currency, setCurrencyState] = useState<SupportedCurrency>(DEFAULT_CURRENCY);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;

    async function load() {
      if (isAuthenticated) {
        try {
          const res = await fetch("/api/currency");
          if (res.ok) {
            const data = (await res.json()) as { currency: string | null };
            if (!cancelled && isSupportedCurrency(data.currency)) {
              setCurrencyState(data.currency);
              setIsLoaded(true);
              return;
            }
          }
        } catch {
          // Fall through to the local default below.
        }
        if (!cancelled) setIsLoaded(true);
        return;
      }

      // Guests: localStorage only (section 5.5 — never persisted to
      // the server for an unauthenticated session).
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!cancelled && isSupportedCurrency(raw)) setCurrencyState(raw);
      } catch {
        // Keep the default.
      }
      if (!cancelled) setIsLoaded(true);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [status, isAuthenticated]);

  const setCurrency = useCallback(
    (next: SupportedCurrency) => {
      setCurrencyState(next);
      if (isAuthenticated) {
        void fetch("/api/currency", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currency: next }),
        }).catch(() => {
          // Best-effort mirror, matching every other authenticated
          // preference sync in this app (lib/db/clientSync.ts) — local
          // state (already updated above) stays correct for this tab
          // regardless of a transient network failure.
        });
      } else {
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {}
      }
    },
    [isAuthenticated],
  );

  const value = useMemo(() => ({ currency, isLoaded, setCurrency }), [currency, isLoaded, setCurrency]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}

export { SUPPORTED_CURRENCIES };
export type { SupportedCurrency };
