"use client";

import { useEffect, useState } from "react";
import { PackageX, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Product } from "@/types/product";

type Outcome =
  | { status: "loading" }
  | { status: "ready"; product: Product }
  | { status: "not_found" }
  | { status: "error" };

export function FetchedProduct({
  id,
  children,
}: {
  id: string;
  children: (product: Product) => React.ReactNode;
}) {
  const { t } = useI18n();
  // Lazy initializer, not an effect — this is the "loading" starting
  // point, computed once per mount (and this component remounts via
  // `key={id}` whenever the id changes, so it's always correct).
  const [outcome, setOutcome] = useState<Outcome>(() => ({ status: "loading" }));

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/buyer/item/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setOutcome({ status: "not_found" });
          return;
        }
        if (!res.ok) {
          setOutcome({ status: "error" });
          return;
        }
        const data = await res.json();
        setOutcome({ status: "ready", product: data.item });
      })
      .catch(() => {
        if (!cancelled) setOutcome({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (outcome.status === "loading") {
    return (
      <p role="status" className="px-5 py-16 text-center text-[13px] text-muted animate-pulse">
        {t("product.loading")}
      </p>
    );
  }

  if (outcome.status === "not_found") {
    return (
      <EmptyState
        icon={PackageX}
        title={t("product.notFoundTitle")}
        hint={t("product.notFoundBody")}
      />
    );
  }

  if (outcome.status === "error") {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t("product.loadErrorTitle")}
        hint={t("product.loadErrorBody")}
      />
    );
  }

  return <>{children(outcome.product)}</>;
}
