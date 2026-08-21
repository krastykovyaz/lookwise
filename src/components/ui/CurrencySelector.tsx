"use client";

import { useCurrency, SUPPORTED_CURRENCIES } from "@/lib/currency/context";

export function CurrencySelector() {
  const { currency, setCurrency } = useCurrency();

  return (
    <div
      role="radiogroup"
      aria-label="Currency"
      className="flex rounded-full border border-border bg-background p-1"
    >
      {SUPPORTED_CURRENCIES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={currency === c}
          onClick={() => setCurrency(c)}
          className={`flex-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
            currency === c
              ? "bg-primary text-primary-foreground"
              : "text-muted hover:text-foreground"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
