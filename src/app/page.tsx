"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useBuyerResults } from "@/lib/results";
import { useStyleProfile } from "@/lib/style/context";
import { useEvents } from "@/lib/events/context";
import { CompassOrb } from "@/components/ai/CompassOrb";
import { AIInput } from "@/components/ai/AIInput";
import { ExamplePrompt } from "@/components/ai/ExamplePrompt";
import { LanguageSelector } from "@/components/ui/LanguageSelector";
import { useNavigationState } from "@/lib/navigation/state";

type Status =
  | "idle"
  | "loading1"
  | "loading2"
  | "loading3"
  | ErrorStatus;

// One status per distinguishable backend failure, so the UI can say
// something more useful than "unable to search eBay".
type ErrorStatus =
  | "error_empty"
  | "error_ai_config"
  | "error_ai_api"
  | "error_ai"
  | "error_ebay_config"
  | "error_ebay_auth"
  | "error_search";

const ERROR_STATUSES: ErrorStatus[] = [
  "error_empty",
  "error_ai_config",
  "error_ai_api",
  "error_ai",
  "error_ebay_config",
  "error_ebay_auth",
  "error_search",
];

// Maps the API's `error` code (see /api/buyer/search) to a status.
const ERROR_CODE_STATUS: Record<string, ErrorStatus> = {
  ai_not_configured: "error_ai_config",
  ai_api_error: "error_ai_api",
  ai_invalid_output: "error_ai",
  ebay_not_configured: "error_ebay_config",
  ebay_auth_failed: "error_ebay_auth",
  ebay_search_failed: "error_search",
  invalid_request: "error_empty",
};

const ERROR_COPY: Record<ErrorStatus, { title: string; body: string }> = {
  error_empty: { title: "buyer.errorEmptyTitle", body: "buyer.errorEmptyBody" },
  error_ai_config: { title: "buyer.errorAiConfigTitle", body: "buyer.errorAiConfigBody" },
  error_ai_api: { title: "buyer.errorAiApiTitle", body: "buyer.errorAiApiBody" },
  error_ai: { title: "buyer.errorAiTitle", body: "buyer.errorAiBody" },
  error_ebay_config: { title: "buyer.errorEbayConfigTitle", body: "buyer.errorEbayConfigBody" },
  error_ebay_auth: { title: "buyer.errorEbayAuthTitle", body: "buyer.errorEbayAuthBody" },
  error_search: { title: "buyer.errorSearchTitle", body: "buyer.errorSearchBody" },
};

// Staged loading copy swaps on a timer purely for perceived progress —
// the actual request is a single call to /api/buyer/search underneath.
const STAGE_DELAY_MS = 900;

export default function BuyerPage() {
  const { t, tList, locale } = useI18n();
  const router = useRouter();
  const { setResults } = useBuyerResults();
  const { searchQuery: query, setSearchQuery: setQuery, setSearchVisibleCount } = useNavigationState();
  const { record: recordEvent } = useEvents();
  const { profile, isLoaded, hasOnboarded } = useStyleProfile();
  const [status, setStatus] = useState<Status>("idle");

  const examples = tList("buyer.examples");
  const isLoading = status === "loading1" || status === "loading2" || status === "loading3";
  // No profile yet -> collect one first, then land straight on /look.
  // Already onboarded -> "Build a Look" always means starting a look,
  // never repeating the style questions.
  const buildALookHref = hasOnboarded ? "/look" : "/look/onboarding?returnTo=/look";

  const handleSubmit = async (value: string) => {
    if (!value.trim()) {
      setStatus("error_empty");
      return;
    }

    setStatus("loading1");
    const stage2 = window.setTimeout(() => setStatus("loading2"), STAGE_DELAY_MS);
    const stage3 = window.setTimeout(() => setStatus("loading3"), STAGE_DELAY_MS * 2);

    try {
      const response = await fetch("/api/buyer/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: value, locale }),
      });
      const data = await response.json();

      window.clearTimeout(stage2);
      window.clearTimeout(stage3);

      if (!response.ok) {
        setStatus(ERROR_CODE_STATUS[data?.error as string] ?? "error_search");
        return;
      }

      setSearchVisibleCount(3);
      setResults({
        query: value,
        criteria: data.query,
        items: data.items,
        total: data.total,
        offset: data.offset ?? 0,
        hasMore: data.hasMore ?? false,
      });
      recordEvent({ type: "search", source: "search", metadata: { query: value } });
      setStatus("idle");
      router.push("/results");
    } catch {
      window.clearTimeout(stage2);
      window.clearTimeout(stage3);
      setStatus("error_search");
    }
  };

  return (
    <div className="flex flex-col px-5 pt-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            {t("buyer.brand")}
          </h1>
          <p className="mt-0.5 text-[14px] text-muted">{t("buyer.tagline")}</p>
        </div>
        <LanguageSelector />
      </div>

      <div className="mt-10">
        <CompassOrb />
      </div>

      <div className="mt-10 text-center px-2">
        <h2 className="text-[21px] font-semibold tracking-tight text-foreground">
          {t("buyer.headline")}
        </h2>
        <p className="mt-1.5 text-[14px] text-muted leading-5">
          {t("buyer.subheadline")}
        </p>
      </div>

      <div className="mt-6">
        <AIInput value={query} onChange={setQuery} onSubmit={handleSubmit} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[11.5px] font-medium text-muted-soft uppercase tracking-wide">
          {t("buyer.or")}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Link
        href={buildALookHref}
        className="mt-3 flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3.5 text-[14px] font-medium text-foreground hover:border-foreground/25 transition-colors"
      >
        <Sparkles size={16} strokeWidth={1.75} />
        {t("look.buildALook")}
      </Link>

      {isLoaded && hasOnboarded && profile && (
        <div className="mt-2.5 flex items-center justify-between px-1">
          <p className="text-[11.5px] leading-4 text-muted">
            {t("look.yourStylePrefix")}{" "}
            <span className="font-medium text-foreground">
              {profile.styleArchetypes.map((id) => t(`look.archetype.${id}.label`)).join(" · ")}
              {profile.budgetRange ? ` · ${t(`look.budget.${profile.budgetRange}`)}` : ""}
            </span>
          </p>
          <Link
            href="/look/onboarding?returnTo=%2F"
            className="shrink-0 text-[11.5px] font-medium text-foreground underline underline-offset-2"
          >
            {t("look.editProfile")}
          </Link>
        </div>
      )}

      {isLoading ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 text-center text-[13px] text-muted animate-pulse"
        >
          {t(`buyer.${status}`)}
        </p>
      ) : ERROR_STATUSES.includes(status as ErrorStatus) ? (
        <div className="mt-5 rounded-2xl border border-warning-bg bg-warning-bg/40 px-4 py-3.5">
          <p className="text-[12.5px] font-medium text-foreground">
            {t(ERROR_COPY[status as ErrorStatus].title)}
          </p>
          <p className="mt-1 text-[12.5px] text-muted leading-5">
            {t(ERROR_COPY[status as ErrorStatus].body)}
          </p>
          {status !== "error_empty" && (
            <button
              type="button"
              onClick={() => handleSubmit(query)}
              className="mt-2.5 text-[12.5px] font-medium text-foreground underline underline-offset-2"
            >
              {t("buyer.retry")}
            </button>
          )}
        </div>
      ) : (
        <div className="mt-5">
          <p className="text-[12px] font-medium text-muted uppercase tracking-wide px-0.5">
            {t("buyer.examplesLabel")}
          </p>
          <div className="mt-2.5 flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {examples.map((example) => (
              <ExamplePrompt key={example} label={example} onSelect={setQuery} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
