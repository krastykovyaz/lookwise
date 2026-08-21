"use client";

import { useEffect, useState } from "react";

/** Section 3 of the notifications spec: the unread count must come
 *  from server state, never be hardcoded, and a zero count shows no
 *  badge at all (not a visible "0"). Fetches once on mount — Profile
 *  already only mounts this when authenticated (see profile/page.tsx),
 *  so no session check is needed here. */
export function NotificationsBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/unread-count")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && typeof data?.count === "number") setCount(data.count);
      })
      .catch(() => {
        // Silent — a failed badge fetch shouldn't disturb the rest of
        // Profile (section 18: notification failures stay contained).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!count) return null;

  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-medium text-background">
      {count > 99 ? "99+" : count}
    </span>
  );
}
