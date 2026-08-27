"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Product } from "@/types/product";
import type { ValidatedEbaySearchCriteria } from "@/lib/schemas";

// How many results are revealed per scroll-triggered load. Search can
// return results in the thousands, so rendering them 20 at a time keeps
// the DOM small instead of mounting every ProductCard at once.
export const REVEAL_STEP = 20;

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
  // How many of `items` are actually rendered right now. Lives here
  // (not as local state on ResultsPage) specifically so it survives
  // navigating to a product and back: /results unmounts on that
  // navigation, and a local useState would reset to REVEAL_STEP,
  // rendering a much shorter page than the user had scrolled through —
  // too short for the scroll-position restore in
  // lib/navigation/state.tsx to find its target, which looked
  // identical to "jumped back to the top". Mirrors why Explore keeps
  // its own item list in a persistent provider rather than page-local
  // state (src/lib/explore/session.tsx).
  revealCount: number;
}

interface BuyerResultsContextValue {
  results: BuyerResultsState | null;
  /** Always starts a fresh reveal window at REVEAL_STEP — this is a
   *  new search, never a continuation. */
  setResults: (state: Omit<BuyerResultsState, "revealCount">) => void;
  appendItems: (items: Product[], offset: number, hasMore: boolean) => void;
  /** Reveals the next REVEAL_STEP already-known items. */
  revealMore: () => void;
  clearResults: () => void;
  getById: (id: string) => Product | undefined;
}

const BuyerResultsContext = createContext<BuyerResultsContextValue | null>(null);

export function BuyerResultsProvider({ children }: { children: React.ReactNode }) {
  const [results, setResultsState] = useState<BuyerResultsState | null>(null);

  const setResults = useCallback((state: Omit<BuyerResultsState, "revealCount">) => {
    setResultsState({ ...state, revealCount: REVEAL_STEP });
  }, []);

  const appendItems = useCallback((items: Product[], offset: number, hasMore: boolean) => {
    setResultsState((prev) => (prev ? { ...prev, items: [...prev.items, ...items], offset, hasMore } : prev));
  }, []);

  const revealMore = useCallback(() => {
    setResultsState((prev) => (prev ? { ...prev, revealCount: prev.revealCount + REVEAL_STEP } : prev));
  }, []);

  const clearResults = useCallback(() => setResultsState(null), []);

  const getById = useCallback(
    (id: string) => results?.items.find((item) => item.id === id),
    [results],
  );

  const value = useMemo(
    () => ({ results, setResults, appendItems, revealMore, clearResults, getById }),
    [results, setResults, appendItems, revealMore, clearResults, getById],
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
