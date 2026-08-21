"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { PreferenceSignal } from "@/types/style";
import type { Product } from "@/types/product";
import { syncSignal } from "@/lib/db/clientSync";

const STORAGE_KEY = "compass.preferenceSignals";
const MAX_SIGNALS = 100;

interface PreferenceContextValue {
  signals: PreferenceSignal[];
  isLoaded: boolean;
  getForProduct: (productId: string) => PreferenceSignal[];
  record: (type: PreferenceSignal["type"], product: Product) => void;
}

const PreferenceContext = createContext<PreferenceContextValue | null>(null);

export function PreferenceSignalsProvider({ children }: { children: React.ReactNode }) {
  const [signals, setSignals] = useState<PreferenceSignal[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const { status } = useSession();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PreferenceSignal[];
        setSignals(Array.isArray(parsed) ? parsed.slice(-MAX_SIGNALS) : []);
      }
    } catch {
      setSignals([]);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const record = useCallback((type: PreferenceSignal["type"], product: Product) => {
    const signal: PreferenceSignal = {
      type,
      productId: product.id,
      brand: product.brand,
      category: product.category,
      occurredAt: new Date().toISOString(),
    };
    setSignals((current) => {
      const next = [...current, signal].slice(-MAX_SIGNALS);
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    if (status === "authenticated" && (type === "like" || type === "dislike")) {
      syncSignal({ productId: product.id, signalType: type });
    }
  }, [status]);

  const getForProduct = useCallback(
    (productId: string) => signals.filter((signal) => signal.productId === productId),
    [signals],
  );

  const value = useMemo(() => ({ signals, isLoaded, getForProduct, record }), [signals, isLoaded, getForProduct, record]);
  return <PreferenceContext.Provider value={value}>{children}</PreferenceContext.Provider>;
}

export function usePreferenceSignals() {
  const ctx = useContext(PreferenceContext);
  if (!ctx) throw new Error("usePreferenceSignals must be used within PreferenceSignalsProvider");
  return ctx;
}
