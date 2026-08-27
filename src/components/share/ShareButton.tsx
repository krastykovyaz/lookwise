"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { useSession } from "next-auth/react";
import { useI18n } from "@/lib/i18n";
import { configuredPublicOrigin } from "@/lib/publicOrigin";

export interface ShareButtonProps {
  /** Resolves the canonical, ref-free path to share (e.g.
   *  "/look/abc123"). Sync when the id is already known (item pages,
   *  a look already opened via its public URL); async when it isn't
   *  yet — e.g. a freshly generated look with only a local id, where
   *  the caller materializes a public snapshot on demand (see
   *  look/page.tsx) and this button awaits that before sharing.
   *  Returning null means "can't be shared yet" — the button no-ops. */
  resolvePath: () => Promise<string | null> | string | null;
  shareTitle: string;
  shareText?: string;
  className?: string;
}

const DEFAULT_CLASS =
  "flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:text-foreground disabled:opacity-50";

/** The canonical URL never carries ?ref= (section 12) — that's added
 *  here, once, right before sharing, from the current user's own
 *  referral code. Guests and pre-existing users without a code yet
 *  simply share the bare canonical link (section 15: "guests do NOT
 *  have a referral code"). */
export function ShareButton({ resolvePath, shareTitle, shareText, className }: ShareButtonProps) {
  const { t } = useI18n();
  const { data: session } = useSession();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const path = await resolvePath();
      if (!path) return;

      // Always the configured production origin when one is set —
      // never window.location.origin in that case. A proxy/CDN can
      // make window.location report a different host than the
      // canonical public one, and in local dev without the var set,
      // window.location.origin is localhost, which is expected to be
      // unshareable rather than something to paper over here.
      const origin = configuredPublicOrigin() ?? window.location.origin;
      const url = new URL(path, origin);
      const referralCode = session?.user?.referralCode;
      if (referralCode) url.searchParams.set("ref", referralCode);
      const href = url.toString();

      // Copy to clipboard unconditionally, before offering the native
      // share sheet — not just as a fallback for when that sheet is
      // cancelled. A successful native share (e.g. picking WhatsApp)
      // used to short-circuit past this entirely, so the link was
      // never actually on the clipboard even though a share visibly
      // happened — leaving nothing to paste anywhere else afterward.
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(href);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (err) {
          console.error("[ShareButton] clipboard write failed:", err);
        }
      }

      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        try {
          await navigator.share({ title: shareTitle, text: shareText, url: href });
        } catch {
          // User cancelled the native sheet, or the platform rejected
          // it — the clipboard copy above already happened either way.
        }
      }
    } catch (err) {
      console.error("[ShareButton] share failed:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={busy}
      aria-label={copied ? t("share.copied") : t("share.button")}
      className={className ?? DEFAULT_CLASS}
    >
      {copied ? <Check size={16} strokeWidth={2} /> : <Share2 size={16} strokeWidth={2} />}
    </button>
  );
}
