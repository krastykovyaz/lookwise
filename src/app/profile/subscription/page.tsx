"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ChevronLeft, Crown, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  resolveSubscriptionViewState,
  shouldContinuePolling,
  type SubscriptionStatusResponse,
} from "@/lib/payments/viewState";

// Section 5 of the Step 3 spec: "reasonable polling interval... do not
// poll indefinitely". Polling only ever reads status (GET) — it never
// creates a payment.
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes

type LoadState = "loading" | "ready" | "error";

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

export default function SubscriptionPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [data, setData] = useState<SubscriptionStatusResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState(false);

  // Initial load (and manual retry via refreshKey) — not authenticated
  // is handled entirely separately below, so this never even fetches
  // for a guest (section 8).
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    fetch("/api/payments/status")
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
          setLoadState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, refreshKey]);

  const viewState = resolveSubscriptionViewState(data);
  const pollingActive = loadState === "ready" && shouldContinuePolling(viewState);
  const pollStartRef = useRef<number | null>(null);

  // Section 5: stops after a terminal/active status (pollingActive
  // becomes false, tearing this effect down), when the page is left
  // (the cleanup function), and after MAX_POLL_DURATION_MS regardless.
  useEffect(() => {
    if (!pollingActive) {
      pollStartRef.current = null;
      return;
    }
    if (pollStartRef.current == null) pollStartRef.current = Date.now();

    const interval = setInterval(() => {
      if (Date.now() - (pollStartRef.current ?? Date.now()) > MAX_POLL_DURATION_MS) {
        clearInterval(interval);
        return;
      }
      fetch("/api/payments/status")
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json) setData(json);
        })
        .catch(() => {
          // A single missed poll isn't fatal — the interval just tries
          // again; only a hard load failure (above) shows the error state.
        });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [pollingActive]);

  const handleSubscribe = async () => {
    if (isCreating) return; // duplicate-click guard
    setIsCreating(true);
    setCreateError(false);
    try {
      const res = await fetch("/api/payments/create", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json?.payment?.paymentUrl) {
        setCreateError(true);
        return;
      }
      // Normal external navigation, not an iframe (Step 3 section 3).
      // The backend/IPN remains the sole source of truth for whether
      // the payment actually succeeds — this redirect claims nothing.
      window.location.href = json.payment.paymentUrl;
    } catch {
      setCreateError(true);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center bg-background/90 backdrop-blur-sm px-3 py-2.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface border border-border text-foreground"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
      </div>

      <div className="px-5">
        <h1 className="text-[21px] font-semibold tracking-tight text-foreground leading-snug">
          {t("subscription.title")}
        </h1>

        {sessionStatus === "loading" && (
          <p role="status" className="px-1 py-16 text-center text-[13px] text-muted animate-pulse">
            {t("subscription.loading")}
          </p>
        )}

        {sessionStatus === "unauthenticated" && (
          <div className="mt-4">
            <EmptyState icon={Crown} title={t("subscription.signInPrompt")} />
            <div className="flex justify-center">
              <Link
                href="/login"
                className="mt-2 rounded-full bg-foreground px-5 py-2.5 text-[13px] font-medium text-background"
              >
                {t("auth.signIn")}
              </Link>
            </div>
          </div>
        )}

        {isAuthenticated && loadState === "loading" && (
          <p role="status" className="px-1 py-16 text-center text-[13px] text-muted animate-pulse">
            {t("subscription.loading")}
          </p>
        )}

        {isAuthenticated && loadState === "error" && (
          <div className="mt-4">
            <EmptyState icon={AlertTriangle} title={t("subscription.errorTitle")} />
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setLoadState("loading");
                  setRefreshKey((k) => k + 1);
                }}
                className="mt-2 rounded-full border border-border bg-surface px-4 py-2 text-[13px] font-medium text-foreground"
              >
                {t("subscription.retry")}
              </button>
            </div>
          </div>
        )}

        {isAuthenticated && loadState === "ready" && (
          <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-background text-foreground">
              <Crown size={20} strokeWidth={1.75} />
            </div>

            {viewState.kind === "active" && (
              <>
                <p className="mt-3 text-[16px] font-semibold text-foreground">{t("subscription.premiumName")}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-positive">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                  {t("subscription.activeLabel")}
                </p>
                <p className="mt-2 text-[13px] text-muted">
                  {t("subscription.validUntil")} {formatDate(viewState.expiresAt, locale)}
                </p>
              </>
            )}

            {viewState.kind === "subscription_expired" && (
              <>
                <p className="mt-3 text-[16px] font-semibold text-foreground">{t("subscription.premiumName")}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-warning">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                  {t("subscription.expiredLabel")}
                </p>
                <p className="mt-2 text-[13px] text-muted">
                  {t("subscription.expiredOn")} {formatDate(viewState.expiresAt, locale)}
                </p>
                <button
                  type="button"
                  onClick={handleSubscribe}
                  disabled={isCreating}
                  className="mt-4 w-full rounded-full bg-foreground py-3 text-[14px] font-medium text-background disabled:opacity-60"
                >
                  {isCreating ? t("subscription.redirecting") : t("subscription.renewButton")}
                </button>
                {createError && <p className="mt-2 text-[12.5px] text-warning">{t("subscription.createError")}</p>}
              </>
            )}

            {viewState.kind === "none" && (
              <>
                <p className="mt-3 text-[16px] font-semibold text-foreground">{t("subscription.productName")}</p>
                <p className="mt-1 text-[20px] font-semibold text-foreground">€17</p>
                <p className="mt-0.5 text-[13px] text-muted">{t("subscription.durationLine")}</p>
                <button
                  type="button"
                  onClick={handleSubscribe}
                  disabled={isCreating}
                  className="mt-4 w-full rounded-full bg-foreground py-3 text-[14px] font-medium text-background disabled:opacity-60"
                >
                  {isCreating ? t("subscription.redirecting") : t("subscription.subscribeButton")}
                </button>
                {createError && <p className="mt-2 text-[12.5px] text-warning">{t("subscription.createError")}</p>}
              </>
            )}

            {viewState.kind === "pending" && (
              <>
                <p className="mt-3 text-[16px] font-semibold text-foreground">{t("subscription.productName")}</p>
                <p className="mt-2 text-[13px] text-muted">{t("subscription.waitingForConfirmation")}</p>
                {viewState.paymentUrl && (
                  <a
                    href={viewState.paymentUrl}
                    className="mt-4 block w-full rounded-full border border-border bg-background py-3 text-center text-[14px] font-medium text-foreground"
                  >
                    {t("subscription.continuePayment")}
                  </a>
                )}
              </>
            )}

            {viewState.kind === "partially_paid" && (
              <>
                <p className="mt-3 text-[16px] font-semibold text-foreground">{t("subscription.productName")}</p>
                <p className="mt-2 text-[13px] text-warning">{t("subscription.partiallyPaid")}</p>
                {viewState.paymentUrl && (
                  <a
                    href={viewState.paymentUrl}
                    className="mt-4 block w-full rounded-full border border-border bg-background py-3 text-center text-[14px] font-medium text-foreground"
                  >
                    {t("subscription.continuePayment")}
                  </a>
                )}
              </>
            )}

            {viewState.kind === "terminal" && (
              <>
                <p className="mt-3 text-[16px] font-semibold text-foreground">{t("subscription.productName")}</p>
                <p className="mt-2 text-[13px] text-muted">{t("subscription.failedOrExpired")}</p>
                <button
                  type="button"
                  onClick={handleSubscribe}
                  disabled={isCreating}
                  className="mt-4 w-full rounded-full bg-foreground py-3 text-[14px] font-medium text-background disabled:opacity-60"
                >
                  {isCreating ? t("subscription.redirecting") : t("subscription.tryAgain")}
                </button>
                {createError && <p className="mt-2 text-[12.5px] text-warning">{t("subscription.createError")}</p>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
