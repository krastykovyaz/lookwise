"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Mail } from "lucide-react";
import { useI18n } from "@/lib/i18n";

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn("resend", { email: email.trim(), redirect: false });
      if (result?.error) {
        setError(t("auth.genericError"));
        setSubmitting(false);
        return;
      }
      router.push("/login/check-email");
    } catch {
      setError(t("auth.genericError"));
      setSubmitting(false);
    }
  }

  return (
    <div className="px-5 pt-10 pb-16 max-w-sm mx-auto">
      <h1 className="text-[22px] font-semibold tracking-tight text-foreground">{t("auth.signInTitle")}</h1>
      <p className="mt-1.5 text-[13.5px] text-muted">{t("auth.signInSubtitle")}</p>

      <button
        type="button"
        onClick={() => signIn("google", { callbackUrl: "/profile" })}
        className="mt-8 w-full flex items-center justify-center gap-2.5 rounded-full border border-border bg-surface py-3 text-[14px] font-medium text-foreground hover:bg-background transition-colors"
      >
        <GoogleGlyph />
        {t("auth.continueWithGoogle")}
      </button>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wide text-muted-soft">{t("auth.orDivider")}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-3">
          <Mail size={16} strokeWidth={1.75} className="text-muted shrink-0" />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.emailPlaceholder")}
            className="w-full bg-transparent text-[14px] text-foreground placeholder:text-muted-soft outline-none"
          />
        </div>
        {error && <p className="text-[12.5px] text-red-500 px-1">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="w-full rounded-full bg-foreground py-3 text-[14px] font-medium text-background disabled:opacity-50 transition-opacity"
        >
          {t("auth.sendLink")}
        </button>
      </form>
    </div>
  );
}
