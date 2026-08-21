"use client";

import { useI18n } from "@/lib/i18n";
import { LOCALES, LOCALE_LABELS, LOCALE_NAMES } from "@/types/locale";

export function LanguageSelector() {
  const { locale, setLocale } = useI18n();

  return (
    <div
      role="radiogroup"
      aria-label="Language"
      className="flex rounded-full border border-border bg-background p-1"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={locale === l}
          title={LOCALE_NAMES[l]}
          onClick={() => setLocale(l)}
          className={`flex-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
            locale === l
              ? "bg-primary text-primary-foreground"
              : "text-muted hover:text-foreground"
          }`}
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
