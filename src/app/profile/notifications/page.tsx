"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Bell, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";

type NotificationType = "ITEM_UNAVAILABLE" | "LOOK_ITEM_UNAVAILABLE" | "REFERRAL" | "SYSTEM";

interface NotificationEntry {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType: "item" | "look" | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

type LoadState = "loading" | "ready" | "error";

// Where clicking a notification actually goes — reuses the app's
// existing entity routes rather than inventing new ones (section 14:
// "rely on the existing entity authorization/public-access rules").
// /look/[lookId] is the public, DB-backed route (not the client-only
// /look?historyId=... history view), so it always resolves regardless
// of what's in the current browser session. REFERRAL/SYSTEM have no
// dedicated destination in the app yet, so they fall back to Profile.
function resolveHref(n: NotificationEntry): string {
  if (n.entityType === "item" && n.entityId) {
    return `/product/${encodeURIComponent(n.entityId)}?source=direct`;
  }
  if (n.entityType === "look" && n.entityId) {
    return `/look/${encodeURIComponent(n.entityId)}`;
  }
  return "/profile";
}

function useRelativeTime(locale: string) {
  return useCallback(
    (iso: string) => {
      const date = new Date(iso);
      const diffMs = date.getTime() - Date.now();
      const diffMinutes = Math.round(diffMs / 60000);
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, "minute");
      const diffHours = Math.round(diffMinutes / 60);
      if (Math.abs(diffHours) < 24) return rtf.format(diffHours, "hour");
      const diffDays = Math.round(diffHours / 24);
      if (Math.abs(diffDays) < 30) return rtf.format(diffDays, "day");
      return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date);
    },
    [locale],
  );
}

export default function NotificationsPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const formatRelative = useRelativeTime(locale);

  const [state, setState] = useState<LoadState>("loading");
  const [items, setItems] = useState<NotificationEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  // Bumped by the retry button to re-run the fetch effect below —
  // keeps the actual setState calls inside the effect nested in the
  // fetch's own .then/.catch (matching FetchedProduct.tsx's pattern),
  // rather than a reusable top-level async function invoked directly
  // from the effect body.
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications?limit=20")
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items ?? []);
        setUnreadCount(data.unreadCount ?? 0);
        setHasMore(Boolean(data.hasMore));
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const handleLoadMore = async () => {
    const last = items[items.length - 1];
    if (!last || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetch(
        `/api/notifications?limit=20&before=${encodeURIComponent(last.createdAt)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setItems((prev) => [...prev, ...(data.items ?? [])]);
      setHasMore(Boolean(data.hasMore));
    } catch {
      // Leave the already-loaded list intact — this is "load more"
      // failing, not the whole page (section 18).
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleMarkAllRead = async () => {
    if (isMarkingAll || unreadCount === 0) return;
    setIsMarkingAll(true);
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } catch {
      // Best-effort optimistic update — a failed request here just
      // means the badge may drift until the next load(), not a broken
      // page.
    } finally {
      setIsMarkingAll(false);
    }
  };

  const handleOpen = (n: NotificationEntry) => {
    if (!n.readAt) {
      const now = new Date().toISOString();
      setItems((prev) => prev.map((item) => (item.id === n.id ? { ...item, readAt: now } : item)));
      setUnreadCount((c) => Math.max(0, c - 1));
      // Fire-and-forget — normal Link navigation below proceeds either way.
      fetch(`/api/notifications/${encodeURIComponent(n.id)}/read`, { method: "POST" }).catch(() => {});
    }
  };

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between bg-background/90 backdrop-blur-sm px-3 py-2.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface border border-border text-foreground"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={isMarkingAll}
            className="text-[13px] font-medium text-foreground disabled:opacity-60"
          >
            {t("notifications.markAllRead")}
          </button>
        )}
      </div>

      <div className="px-5">
        <h1 className="text-[21px] font-semibold tracking-tight text-foreground leading-snug">
          {t("notifications.title")}
        </h1>

        {state === "loading" && (
          <p role="status" className="px-1 py-16 text-center text-[13px] text-muted animate-pulse">
            {t("notifications.loadingMore")}
          </p>
        )}

        {state === "error" && (
          <div className="mt-4">
            <EmptyState icon={AlertTriangle} title={t("notifications.errorTitle")} />
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setState("loading");
                  setRefreshKey((k) => k + 1);
                }}
                className="mt-2 rounded-full border border-border bg-surface px-4 py-2 text-[13px] font-medium text-foreground"
              >
                {t("notifications.retry")}
              </button>
            </div>
          </div>
        )}

        {state === "ready" && items.length === 0 && (
          <div className="mt-4">
            <EmptyState icon={Bell} title={t("notifications.emptyTitle")} hint={t("notifications.emptyHint")} />
          </div>
        )}

        {state === "ready" && items.length > 0 && (
          <div className="mt-4 rounded-2xl border border-border bg-surface divide-y divide-border overflow-hidden">
            {items.map((n) => (
              <Link
                key={n.id}
                href={resolveHref(n)}
                onClick={() => handleOpen(n)}
                className={`flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-background/60 ${
                  n.readAt ? "" : "bg-background/40"
                }`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    n.readAt ? "bg-transparent" : "bg-foreground"
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-[14px] leading-snug ${n.readAt ? "text-foreground" : "font-semibold text-foreground"}`}>
                    {n.title}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted leading-snug line-clamp-2">{n.body}</p>
                  <p className="mt-1 text-[11.5px] text-muted-soft">{formatRelative(n.createdAt)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}

        {state === "ready" && hasMore && (
          <div className="flex justify-center py-6">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="rounded-full border border-border bg-surface px-4 py-2 text-[13px] font-medium text-foreground disabled:opacity-60"
            >
              {isLoadingMore ? t("notifications.loadingMore") : t("notifications.loadMore")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
