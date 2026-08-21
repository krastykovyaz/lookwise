"use client";

import { Heart, Bookmark } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useCurrency } from "@/lib/currency/context";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductCard } from "@/components/products/ProductCard";
import { useFavorites } from "@/lib/products/favorites";
import { useSavedLooks, type SavedLookEntry } from "@/lib/look/savedLooks";
import { formatPrice } from "@/lib/currency/format";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

// Small skeleton grid shown while the section is still loading — never
// a long blank freeze (task: "Loading state should be handled without
// a visible long freeze"), and distinct from the empty state so an
// authenticated user's saved items never flash "you have nothing
// saved" before the server-authoritative check has actually settled
// (see FavoritesProvider/SavedLooksProvider's isServerSynced).
function SectionSkeleton() {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="h-56 animate-pulse rounded-3xl bg-surface" />
      ))}
    </div>
  );
}

function SavedLookCard({ entry }: { entry: SavedLookEntry }) {
  const { currency } = useCurrency();
  const { removeSaved } = useSavedLooks();
  const products = entry.look.components.map((c) => c.product).filter(Boolean);

  return (
    <Link
      href={`/look?historyId=${encodeURIComponent(entry.id)}`}
      className="group relative block overflow-hidden rounded-3xl border border-border bg-surface transition-shadow hover:shadow-[0_4px_20px_rgba(20,19,15,0.07)]"
    >
      <button
        type="button"
        aria-pressed="true"
        aria-label="Remove from saved looks"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          removeSaved(entry.id);
        }}
        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 border border-border backdrop-blur-sm"
      >
        <Bookmark size={15} strokeWidth={2} className="fill-foreground text-foreground" />
      </button>
      <div className="grid grid-cols-2 gap-px bg-border">
        {products.slice(0, 4).map((product) => (
          <div key={product!.id} className="relative aspect-square bg-background">
            <Image src={product!.image} alt="" fill sizes="240px" className="object-cover" />
          </div>
        ))}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-foreground">
            {entry.look.title}
          </h3>
          {formatPrice(entry.look.totalPrice, entry.look.currency, currency) && (
            <p className="shrink-0 text-[13px] font-semibold text-foreground">
              {formatPrice(entry.look.totalPrice, entry.look.currency, currency)}
            </p>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted">
          <span>{new Date(entry.savedAt).toLocaleDateString()}</span>
          <span className="flex items-center gap-1">
            <ArrowRight size={13} />
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function SavedPage() {
  const { t } = useI18n();
  const { products, isLoaded: productsLoaded, isServerSynced: productsSynced } = useFavorites();
  const { savedLooks, isLoaded: looksLoaded, isServerSynced: looksSynced } = useSavedLooks();

  // Ready to render a real empty/populated state only once BOTH the
  // fast local read and (for an authenticated user) the slower
  // server-authoritative check have settled — see the providers'
  // isServerSynced comment for why this matters (task 1: "Empty state
  // should only appear when that particular section is actually
  // empty").
  const productsReady = productsLoaded && productsSynced;
  const looksReady = looksLoaded && looksSynced;

  return (
    <div className="px-5 pt-6 pb-10">
      <h1 className="text-[22px] font-semibold tracking-tight text-foreground">{t("saved.title")}</h1>

      {/* Saved Products */}
      <section className="mt-6">
        <h2 className="text-[16px] font-semibold text-foreground">{t("saved.products")}</h2>
        {!productsReady ? (
          <SectionSkeleton />
        ) : products.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} source="direct" />
            ))}
          </div>
        ) : (
          <EmptyState icon={Heart} title={t("saved.noProducts")} hint={t("saved.noProductsHint")} />
        )}
      </section>

      {/* Saved Looks — kept as its own section, never mixed with
          Saved Products (task 1: "Do not mix Saved Products with
          Saved Looks"). */}
      <section className="mt-8">
        <h2 className="text-[16px] font-semibold text-foreground">{t("saved.looks")}</h2>
        {!looksReady ? (
          <SectionSkeleton />
        ) : savedLooks.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {savedLooks.map((entry) => (
              <SavedLookCard key={entry.id} entry={entry} />
            ))}
          </div>
        ) : (
          <EmptyState icon={Bookmark} title={t("saved.noLooks")} hint={t("saved.noLooksHint")} />
        )}
      </section>
    </div>
  );
}
