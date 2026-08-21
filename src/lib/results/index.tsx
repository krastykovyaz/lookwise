"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Product } from "@/types/product";
import type { ValidatedEbaySearchCriteria } from "@/lib/schemas";

interface BuyerResultsState {
  query: string;
  criteria: ValidatedEbaySearchCriteria | null;
  items: Product[];
  total: number;
  // Pagination: how many items have already been fetched from eBay
  // (the next "load more" page request starts here), and whether eBay
  // reports more beyond that. Search fetches one page at a time instead
  // of every result up front — see src/lib/ebay/index.ts.
  offset: number;
  hasMore: boolean;
}

interface BuyerResultsContextValue {
  results: BuyerResultsState | null;
  setResults: (state: BuyerResultsState) => void;
  appendItems: (items: Product[], offset: number, hasMore: boolean) => void;
  clearResults: () => void;
  getById: (id: string) => Product | undefined;
}

const BuyerResultsContext = createContext<BuyerResultsContextValue | null>(null);

export function BuyerResultsProvider({ children }: { children: React.ReactNode }) {
  const [results, setResultsState] = useState<BuyerResultsState | null>(null);

  const setResults = useCallback((state: BuyerResultsState) => {
    setResultsState(state);
  }, []);

  const appendItems = useCallback((items: Product[], offset: number, hasMore: boolean) => {
    setResultsState((prev) => (prev ? { ...prev, items: [...prev.items, ...items], offset, hasMore } : prev));
  }, []);

  const clearResults = useCallback(() => setResultsState(null), []);

  const getById = useCallback(
    (id: string) => results?.items.find((item) => item.id === id),
    [results],
  );

  const value = useMemo(
    () => ({ results, setResults, appendItems, clearResults, getById }),
    [results, setResults, appendItems, clearResults, getById],
  );

  return (
    <BuyerResultsContext.Provider value={value}>
      {children}
    </BuyerResultsContext.Provider>
  );
}

export function useBuyerResults() {
  const ctx = useContext(BuyerResultsContext);
  if (!ctx) throw new Error("useBuyerResults must be used within BuyerResultsProvider");
  return ctx;
}
