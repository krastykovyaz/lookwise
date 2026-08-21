"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useStyleProfile } from "@/lib/style/context";

export function LookProfileSummary({
  editReturnTo = "/profile",
}: {
  /** Where "Edit"/"Build a Look" should send the user back to after
   *  onboarding saves — see the returnTo param read by /look/onboarding. */
  editReturnTo?: string;
}) {
  const { t } = useI18n();
  const { profile, isLoaded, hasOnboarded } = useStyleProfile();
  const onboardingHref = `/look/onboarding?returnTo=${encodeURIComponent(editReturnTo)}`;

  if (!isLoaded) return null;

  if (!hasOnboarded || !profile) {
    return (
      <div className="mt-2 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background text-foreground">
            <Sparkles size={16} strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-[13.5px] font-medium text-foreground">
              {t("look.profileEmptyTitle")}
            </p>
            <p className="text-[12px] text-muted">{t("look.profileEmptyBody")}</p>
          </div>
        </div>
        <Link
          href={onboardingHref}
          className="mt-3 inline-flex rounded-full bg-primary px-4 py-2 text-[12.5px] font-medium text-primary-foreground"
        >
          {t("look.buildALook")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap gap-1.5">
        {profile.styleArchetypes.map((id) => (
          <span
            key={id}
            className="rounded-full bg-background px-2.5 py-1 text-[12px] font-medium text-foreground"
          >
            {t(`look.archetype.${id}.label`)}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[12.5px] text-muted">
        <span>
          {t("look.budgetLabel")}:{" "}
          <span className="text-foreground">
            {profile.budgetRange ? t(`look.budget.${profile.budgetRange}`) : "—"}
          </span>
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[12.5px] text-muted">
        <span>
          {t("look.locationLabel")}:{" "}
          <span className="text-foreground">{profile.location?.city ?? "—"}</span>
        </span>
      </div>
      <Link
        href={onboardingHref}
        className="mt-3 inline-block text-[12.5px] font-medium text-foreground underline underline-offset-2"
      >
        {t("look.editProfile")}
      </Link>
    </div>
  );
}
