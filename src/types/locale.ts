export type Locale = "en" | "ru" | "fr";

export const LOCALES: Locale[] = ["en", "ru", "fr"];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  ru: "RU",
  fr: "FR",
};

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  fr: "Français",
};

// Dictionaries are plain nested string maps, with string arrays
// allowed as leaves (e.g. example-prompt lists). Kept intentionally
// shallow (feature-level keys) so any translator can extend them
// without touching component code.
export type Dictionary = { [key: string]: string | string[] | Dictionary };
