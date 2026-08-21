import type { Product } from "@/types/product";
import { ProductCard } from "@/components/products/ProductCard";

export function ProductGrid({
  products,
  onOpen,
}: {
  products: Product[];
  /** Forwarded to every ProductCard — see its own doc for what this is for. */
  onOpen?: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} onOpen={onOpen} />
      ))}
    </div>
  );
}
