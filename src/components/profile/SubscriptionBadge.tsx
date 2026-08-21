"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

/** Mirrors NotificationsBadge.tsx's pattern: a cheap status-only fetch
 *  for the Profile row, independent of the full subscription page.
 *  Shows nothing at all for a non-subscriber (matches the Notifications
 *  badge's "no visible '0'" spirit — nothing to announce here either). */
export function SubscriptionBadge() {
  const { t } = useI18n();
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.subscription?.status === "active") setIsActive(true);
      })
      .catch(() => {
        // Silent — a failed badge fetch shouldn't disturb the rest of Profile.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isActive) return null;

  return (
    <span className="rounded-full bg-positive-bg px-2.5 py-1 text-[11px] font-medium text-positive">
      {t("subscription.activeLabel")}
    </span>
  );
}
