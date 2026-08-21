"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Dictionary, Locale } from "@/types/locale";
import { DEFAULT_LOCALE, LOCALES } from "@/types/locale";
import en from "@/locales/en.json";
import ru from "@/locales/ru.json";
import fr from "@/locales/fr.json";

const DICTIONARIES: Record<Locale, Dictionary> = { en, ru, fr };

const STORAGE_KEY = "compass.locale";

function resolve(
  dict: Dictionary,
  path: string,
): string | string[] | Dictionary | undefined {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = dict;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Translate a dot-path key, e.g. t("buyer.headline"). */
  t: (key: string) => string;
  /** Translate a dot-path key that points to a string array. */
  tList: (key: string) => string[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    // Reads a value from an external system (localStorage) once on
    // mount to hydrate client-only state that can't be known during
    // SSR. Intentional one-shot sync, not a cascading-render pattern.
    const stored = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && LOCALES.includes(stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocaleState(stored);
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: string) => {
      const value = resolve(DICTIONARIES[locale], key);
      if (typeof value === "string") return value;
      const fallback = resolve(DICTIONARIES[DEFAULT_LOCALE], key);
      return typeof fallback === "string" ? fallback : key;
    },
    [locale],
  );

  const tList = useCallback(
    (key: string) => {
      const value = resolve(DICTIONARIES[locale], key);
      if (Array.isArray(value)) return value;
      const fallback = resolve(DICTIONARIES[DEFAULT_LOCALE], key);
      return Array.isArray(fallback) ? fallback : [];
    },
    [locale],
  );

  const contextValue = useMemo(
    () => ({ locale, setLocale, t, tList }),
    [locale, setLocale, t, tList],
  );

  return (
    <I18nContext.Provider value={contextValue}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
