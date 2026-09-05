"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, LocateFixed } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useStyleProfile } from "@/lib/style/context";
import {
  formatCoordinates,
  requestBrowserLocation,
  type Coordinates,
} from "@/lib/style/geolocation";
import type { BudgetRangeId, StyleArchetypeId, UserLocation } from "@/types/style";
import { BUDGET_RANGES, STYLE_ARCHETYPES } from "@/types/style";
import { OnboardingProgress } from "@/components/look/OnboardingProgress";
import { StyleArchetypeCard } from "@/components/look/StyleArchetypeCard";
import { OptionChip } from "@/components/look/OptionChip";

const TOTAL_STEPS = 3;
const DEFAULT_RETURN_TO = "/look";

type LocationFieldStatus = "idle" | "locating" | "resolved" | "unresolved" | "error";

export default function LookOnboardingPage() {
  return (
    <Suspense fallback={null}>
      <LookOnboardingForm />
    </Suspense>
  );
}

function LookOnboardingForm() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, isLoaded, saveProfile } = useStyleProfile();

  const returnTo = searchParams.get("returnTo") || DEFAULT_RETURN_TO;

  const [step, setStep] = useState(1);
  const [showHelp, setShowHelp] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const [archetypes, setArchetypes] = useState<StyleArchetypeId[]>([]);
  const [budgetRange, setBudgetRange] = useState<BudgetRangeId | null>(null);

  const [cityInput, setCityInput] = useState("");
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationFieldStatus>("idle");
  const [saving, setSaving] = useState(false);

  // Editing an existing profile should start from what's already
  // saved, not force the user through blank steps again (see "Edit
  // Style Profile" in the milestone spec). One-shot sync from the
  // StyleProfileProvider's own client-only state once it resolves —
  // same "hydrate from an external source on mount" pattern the
  // I18nProvider uses for the locale preference.
  useEffect(() => {
    if (!isLoaded || seeded) return;
    if (profile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setArchetypes(profile.styleArchetypes);
      setBudgetRange(profile.budgetRange);
      if (profile.location) {
        setCityInput(profile.location.city ?? "");
        if (
          profile.location.source === "geolocation" &&
          profile.location.latitude != null &&
          profile.location.longitude != null
        ) {
          setCoords({ latitude: profile.location.latitude, longitude: profile.location.longitude });
        }
      }
    }
    setSeeded(true);
  }, [isLoaded, profile, seeded]);

  const toggleArchetype = (id: StyleArchetypeId) => {
    setArchetypes((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    );
  };

  const handleUseLocation = async () => {
    setLocationStatus("locating");
    try {
      const position = await requestBrowserLocation();
      setCoords(position);
      setLocationStatus("resolved");
    } catch {
      setCoords(null);
      setLocationStatus("error");
    }
  };

  const finish = (location: UserLocation | null) => {
    saveProfile({ styleArchetypes: archetypes, budgetRange, location });
    router.push(returnTo);
  };

  const goNext = async () => {
    if (step < TOTAL_STEPS) {
      setStep((s) => s + 1);
      return;
    }

    setSaving(true);
    try {
      let location: UserLocation | null = null;
      if (coords) {
        location = {
          city: cityInput.trim() || null,
          country: null,
          latitude: coords.latitude,
          longitude: coords.longitude,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          source: "geolocation",
        };
      } else if (cityInput.trim()) {
        try {
          const res = await fetch("/api/geocode/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ city: cityInput.trim() }),
          });
          if (res.ok) {
            const data = await res.json();
            location = {
              city: data.city ?? cityInput.trim(),
              country: data.country ?? null,
              latitude: Number(data.latitude),
              longitude: Number(data.longitude),
              timezone:
                data.timezone ??
                Intl.DateTimeFormat().resolvedOptions().timeZone,
              source: "manual",
            };
          } else {
            location = {
              city: cityInput.trim(),
              country: null,
              latitude: null,
              longitude: null,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              source: "manual",
            };
          }
        } catch {
          location = {
            city: cityInput.trim(),
            country: null,
            latitude: null,
            longitude: null,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            source: "manual",
          };
        }
      }
      finish(location);
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    if (step === 1) {
      router.back();
      return;
    }
    setStep((s) => s - 1);
  };

  return (
    <div className="flex flex-col px-5 pt-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={goBack}
          aria-label={t("common.back")}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:text-foreground hover:bg-background transition-colors -ml-1.5"
        >
          <ChevronLeft size={20} strokeWidth={1.75} />
        </button>
        <div className="flex-1">
          <OnboardingProgress step={step} total={TOTAL_STEPS} />
        </div>
      </div>

      {step === 1 && (
        <div className="mt-7">
          <h1 className="text-[21px] font-semibold tracking-tight text-foreground">
            {t("look.step1Title")}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-muted leading-5">{t("look.step1Body")}</p>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            {STYLE_ARCHETYPES.map((id) => (
              <StyleArchetypeCard
                key={id}
                id={id}
                label={t(`look.archetype.${id}.label`)}
                description={t(`look.archetype.${id}.description`)}
                selected={archetypes.includes(id)}
                onToggle={toggleArchetype}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="mt-4 text-[12.5px] font-medium text-muted underline underline-offset-2"
          >
            {t("look.helpMeChoose")}
          </button>
          {showHelp && (
            <p className="mt-2 rounded-xl bg-background px-3.5 py-3 text-[12.5px] text-muted leading-5">
              {t("look.helpMeChooseTip")}
            </p>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="mt-7">
          <h1 className="text-[21px] font-semibold tracking-tight text-foreground">
            {t("look.step2Title")}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-muted leading-5">{t("look.step2Body")}</p>

          <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {BUDGET_RANGES.map((id) => (
              <OptionChip
                key={id}
                label={t(`look.budget.${id}`)}
                selected={budgetRange === id}
                onSelect={() => setBudgetRange(id)}
              />
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-7">
          <h1 className="text-[21px] font-semibold tracking-tight text-foreground">
            {t("look.step3Title")}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-muted leading-5">{t("look.step3Body")}</p>

          <button
            type="button"
            onClick={handleUseLocation}
            disabled={locationStatus === "locating"}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3.5 text-[14px] font-medium text-foreground hover:border-foreground/25 transition-colors disabled:opacity-60"
          >
            <LocateFixed size={16} strokeWidth={1.75} />
            {locationStatus === "locating" ? t("look.locating") : t("look.useMyLocation")}
          </button>

          {locationStatus === "error" && (
            <p className="mt-2 text-[12.5px] text-muted">{t("look.locationDenied")}</p>
          )}
          {locationStatus === "resolved" && coords && (
            <p className="mt-2 text-[12.5px] text-muted">
              {t("look.locationFoundNote").replace("{coords}", formatCoordinates(coords))}
            </p>
          )}

          <div className="mt-4">
            <label className="mb-1.5 block text-[12px] font-medium text-muted uppercase tracking-wide">
              {t("look.cityLabel")} <span className="normal-case tracking-normal">({t("look.optional")})</span>
            </label>
            <input
              type="text"
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              placeholder={t("look.cityPlaceholder")}
              className="w-full rounded-2xl border border-border bg-surface px-4 py-3.5 text-[16px] text-foreground placeholder:text-muted-soft outline-none focus:border-foreground/25"
            />
          </div>
        </div>
      )}

      <div className="mt-8 mb-4 flex items-center justify-between gap-3">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => (step < TOTAL_STEPS ? setStep((s) => s + 1) : finish(null))}
            className="text-[13px] font-medium text-muted"
          >
            {t("look.skip")}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={goNext}
          disabled={saving || (step === 1 && archetypes.length === 0)}
          className="rounded-full bg-primary px-6 py-3 text-[14px] font-medium text-primary-foreground transition-transform active:scale-95 disabled:opacity-40"
        >
          {saving ? t("look.saving") : step < TOTAL_STEPS ? t("look.continue") : t("look.finish")}
        </button>
      </div>
    </div>
  );
}
