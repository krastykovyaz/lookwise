"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/** Section 5/13: the referral param must not affect what's rendered
 *  (canonical content, OG metadata) — so this never touches the page
 *  body, it only fires a best-effort attribution POST off to the side
 *  once mounted. Safe to include on every public Look/Item page; it's
 *  a no-op when there's no ?ref= param. */
export function ReferralCapture({
  sourceType,
  sourceId,
}: {
  sourceType: "look" | "item";
  sourceId: string;
}) {
  const searchParams = useSearchParams();
  const referralCode = searchParams.get("ref");

  useEffect(() => {
    if (!referralCode) return;
    fetch("/api/referral/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referralCode, sourceType, sourceId }),
    }).catch(() => {
      // Best-effort — a failed attribution capture must never block
      // or degrade viewing the shared content.
    });
    // Intentionally only re-fires if the code/source actually changes,
    // not on every render.
  }, [referralCode, sourceType, sourceId]);

  return null;
}
