"use client";

import { Heart } from "lucide-react";
import type { Product } from "@/types/product";
import { useFavorites } from "@/lib/products/favorites";

export function SaveButton({ product, className = "" }: { product: Product; className?: string }) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const saved = isFavorite(product.id);

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Remove from favorites" : "Add to favorites"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(product);
      }}
      className={`flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 border border-border backdrop-blur-sm transition-colors ${className}`}
    >
      <Heart
        size={15}
        strokeWidth={2}
        className={saved ? "fill-foreground text-foreground" : "text-muted"}
      />
    </button>
  );
}
