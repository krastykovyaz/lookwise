import "server-only";
import type { Product } from "@/types/product";

export type ProductGender = "men" | "women" | "unisex" | "unknown";

const WOMEN = /\b(women|women's|woman|ladies|lady|female|girls|girl|womens)\b/i;
const MEN = /\b(men|men's|man|male|boys|boy|mens)\b/i;
const UNISEX = /\b(unisex|gender[- ]?neutral)\b/i;

export function getProductGender(product: Product): ProductGender {
  const text = `${product.category ?? ""} ${product.title}`;
  if (UNISEX.test(text)) return "unisex";
  const women = WOMEN.test(text);
  const men = MEN.test(text);
  if (women && !men) return "women";
  if (men && !women) return "men";
  return "unknown";
}

export function gendersCompatible(lookGender: ProductGender, candidateGender: ProductGender): boolean {
  // Never silently combine a known men's piece with a known women's piece.
  // Unknown pieces are NOT treated as universally compatible: doing so
  // allowed an unknown item to bridge a men's anchor to a women's filler.
  if (lookGender === "unknown" || candidateGender === "unknown") {
    return lookGender === candidateGender;
  }

  if (lookGender === "unisex" || candidateGender === "unisex") return true;
  return lookGender === candidateGender;
}
