import "server-only";
import type { Product } from "@/types/product";

export const COLOR_GROUPS = [
  "black",
  "white",
  "grey",
  "navy",
  "blue",
  "brown",
  "beige",
  "green",
  "red",
  "yellow",
  "pink",
  "orange",
  "purple",
] as const;

export type ColorGroup = (typeof COLOR_GROUPS)[number];

// A couple of common synonyms fold into a group so "charcoal" still
// matches "grey", etc. Deliberately small — this is a lightweight
// heuristic (section 6: "Do not build a full computer-vision color
// system"), not a color taxonomy.
const SYNONYMS: Record<string, ColorGroup> = {
  charcoal: "grey",
  gray: "grey",
  cream: "beige",
  ivory: "white",
  tan: "beige",
  khaki: "beige",
  camel: "beige",
  maroon: "red",
  burgundy: "red",
  olive: "green",
  mint: "green",
  denim: "blue",
  indigo: "navy",
  lilac: "purple",
  lavender: "purple",
  gold: "yellow",
  coral: "orange",
  fuchsia: "pink",
  magenta: "pink",
};

const ALL_COLOR_WORDS = [...COLOR_GROUPS, ...Object.keys(SYNONYMS)];
const COLOR_PATTERN = new RegExp(`\\b(${ALL_COLOR_WORDS.join("|")})\\b`, "i");

// Extracts a single dominant color group from whatever text metadata a
// product has. Checks the structured `color` field first when eBay
// supplied one (item.color from the Browse API — see
// lib/ebay/normalize.ts), then falls back to scanning the title/
// category text. Good enough for a lightweight compatibility check,
// not meant to be authoritative.
export function extractColor(product: Product): ColorGroup | null {
  const structured = product.color?.toLowerCase().match(COLOR_PATTERN);
  if (structured) {
    const word = structured[1].toLowerCase();
    return (SYNONYMS[word] as ColorGroup | undefined) ?? (word as ColorGroup);
  }
  const haystack = `${product.title} ${product.category ?? ""}`.toLowerCase();
  const match = haystack.match(COLOR_PATTERN);
  if (!match) return null;
  const word = match[1].toLowerCase();
  return (SYNONYMS[word] as ColorGroup | undefined) ?? (word as ColorGroup);
}

// Pairs that read as a deliberate, well-put-together combination.
// Symmetric — checked both directions.
const STRONG_PAIRS: [ColorGroup, ColorGroup][] = [
  ["black", "white"],
  ["navy", "beige"],
  ["navy", "white"],
  ["blue", "white"],
  ["brown", "beige"],
  ["grey", "black"],
  ["grey", "white"],
  ["grey", "navy"],
  ["beige", "white"],
  ["black", "navy"],
];

function isStrongPair(a: ColorGroup, b: ColorGroup): boolean {
  return STRONG_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// Colors that tend to clash when paired together (two competing bright/
// saturated hues) — a mild penalty, never a hard rejection.
const CLASHING_PAIRS: [ColorGroup, ColorGroup][] = [
  ["red", "green"],
  ["red", "orange"],
  ["red", "pink"],
  ["orange", "purple"],
  ["orange", "pink"],
  ["yellow", "purple"],
  ["green", "purple"],
];

function isClashingPair(a: ColorGroup, b: ColorGroup): boolean {
  return CLASHING_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// Returns a 0–1 compatibility score. Unknown color on either side is
// always neutral (0.5) — section 6: "never reject the product solely
// because color is unknown."
export function colorCompatibility(a: ColorGroup | null, b: ColorGroup | null): number {
  if (!a || !b) return 0.5;
  if (a === b) return 0.8; // e.g. black + black — a monochrome look reads as intentional
  if (isStrongPair(a, b)) return 0.9;
  if (isClashingPair(a, b)) return 0.35;
  // Neutrals (black/white/grey/navy/beige/brown) pair reasonably with
  // almost anything that isn't an explicit clash.
  const NEUTRALS: ColorGroup[] = ["black", "white", "grey", "navy", "beige", "brown"];
  if (NEUTRALS.includes(a) || NEUTRALS.includes(b)) return 0.7;
  return 0.55;
}
