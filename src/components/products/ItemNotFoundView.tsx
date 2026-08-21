"use client";

import { PackageX } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";

/** Rendered directly by /item/[itemId]'s page.tsx when the item can't be
 *  resolved (see fetchPublicProductWithFallback). Deliberately NOT a
 *  Next.js not-found() + not-found.tsx pair: a colocated not-found.tsx
 *  for this segment wasn't picked up by the Turbopack build in this
 *  Next.js version (it fell through to the framework's bare, unstyled
 *  default 404 — indistinguishable from a blank page), so this renders
 *  the same styled message inline instead of relying on that
 *  file-convention boundary. */
export function ItemNotFoundView() {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={PackageX}
      title={t("product.notFoundTitle")}
      hint={t("product.notFoundBody")}
    />
  );
}
