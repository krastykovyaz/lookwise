"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { GeneratedLook } from "@/types/style";
import { useI18n } from "@/lib/i18n";
import { useCurrency } from "@/lib/currency/context";
import { formatPrice } from "@/lib/currency/format";
import { ProductCard } from "@/components/products/ProductCard";
import { ShareButton } from "@/components/share/ShareButton";
import { ReferralCapture } from "@/components/share/ReferralCapture";
import { useLookHistory } from "@/lib/look/history";

/** Body of the public, guest-viewable /look/[lookId] page. Reuses the
 *  same ProductCard grid style as the Look generator page
 *  (app/look/page.tsx) rather than a second rendering — the only
 *  meaningful differences here are: no generation controls, a
 *  known-durable id (so Share never needs the async
 *  materialize-a-snapshot step), and recording the open as a real
 *  view via the existing Recently Viewed hook (section 17). */
export function PublicLookView({ look, lookId }: { look: GeneratedLook; lookId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { currency } = useCurrency();
  const { recordViewedLook } = useLookHistory();
  const recordedRef = useRef(false);

  useEffect(() => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    recordViewedLook(look);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookId]);

  return (
    <div>
      <ReferralCapture sourceType="look" sourceId={lookId} />
      <div className="sticky top-0 z-10 flex items-center justify-between bg-background/90 backdrop-blur-sm px-3 py-2.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface border border-border text-foreground"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <ShareButton resolvePath={() => `/look/${lookId}`} shareTitle={look.title} />
      </div>

      <div className="px-5 pb-10">
        <h1 className="mt-2 text-[20px] font-semibold tracking-tight text-foreground">{look.title}</h1>
        {look.description && (
          <p className="mt-2 max-w-[34rem] text-[13px] leading-5 text-muted">{look.description}</p>
        )}
        {look.totalPrice != null && (
          <p className="mt-2 text-[15px] font-semibold text-foreground">
            {formatPrice(look.totalPrice, look.currency, currency, { maximumFractionDigits: 0 })}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          {look.components.map((component, index) => (
            <div key={`${component.role}-${index}`}>
              <p className="mb-1.5 px-0.5 text-[10.5px] font-medium uppercase tracking-wide text-muted">
                {component.role}
              </p>
              {component.product ? (
                <ProductCard product={component.product} source="look" />
              ) : (
                <div className="rounded-2xl border border-border bg-surface p-4 text-[12px] text-muted">
                  {component.searchQuery}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
