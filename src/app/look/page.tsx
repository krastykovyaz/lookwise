"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, MapPin, CloudSun, RefreshCw, ThumbsUp, ThumbsDown, ChevronLeft, Bookmark } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useStyleProfile } from "@/lib/style/context";
import {
  LOOK_INTENT_OPTIONS,
  MOOD_OPTIONS,
  type LookMood,
  type GeneratedLook,
  type LookContextLocation,
  type WeatherData,
  type LookGender,
} from "@/types/style";
import {
  getBrowserTemporalContext,
  requestBrowserLocation,
  type Coordinates,
} from "@/lib/style/geolocation";
import { LookProfileSummary } from "@/components/look/LookProfileSummary";
import { OptionChip } from "@/components/look/OptionChip";
import { ProductCard } from "@/components/products/ProductCard";
import { useLookHistory } from "@/lib/look/history";
import { useSavedLooks } from "@/lib/look/savedLooks";
import { usePreferenceSignals } from "@/lib/style/preferences";
import { useProductSignals } from "@/lib/style/productSignals";
import { useEvents } from "@/lib/events/context";
import { useCurrency } from "@/lib/currency/context";
import { formatPrice } from "@/lib/currency/format";
import { lookSnapshot } from "@/lib/db/clientSync";
import { ShareButton } from "@/components/share/ShareButton";

type GenerateState = "idle" | "pending" | "error";

export default function LookPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { profile, isLoaded, hasOnboarded } = useStyleProfile();
  const { latestLook, looks, recordLookHistory, recordViewedLook, isGeneratingLook, setIsGeneratingLook } =
    useLookHistory();
  const { isSaved, toggleSaved } = useSavedLooks();
  const { signals, record } = usePreferenceSignals();
  const { getSignal, isPending, ensureLoaded, toggle } = useProductSignals();
  const { currency } = useCurrency();
  const { record: recordEvent } = useEvents();

  const [intent, setIntent] = useState<string | null>(null);
  const [lookGender, setLookGender] = useState<LookGender>("women");
  const [mood, setMood] = useState<LookMood | null>(null);
  const [freeText, setFreeText] = useState("");
  const [currentCoordinates, setCurrentCoordinates] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "locating" | "ready" | "denied">("idle");
  const [generateState, setGenerateState] = useState<GenerateState>("idle");
  const [generatedLook, setGeneratedLook] = useState<GeneratedLook | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const recordedHistoryIdRef = useRef<string | null>(null);
  // "Create my look" is a fire-and-forget request (intentionally: the
  // user can navigate away and the generation still completes and gets
  // recorded — see recordViewedLook below). Its .then() closure can
  // therefore run long after this component has unmounted; this guards
  // the one thing in that closure with a side effect on OTHER pages
  // (router.replace) so a finished generation never yanks the user back
  // to /look from wherever they've since navigated to.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  // Caches this browser session's public snapshot id per local look id
  // (see /api/look/share) so re-clicking Share on the same look never
  // materializes a second snapshot row. Keyed off generatedLook.id,
  // which normalizeLook() (lib/look/history.tsx) guarantees is set.
  const shareIdsRef = useRef<Map<string, string>>(new Map());

  const temporal = useMemo(() => getBrowserTemporalContext(), []);

  useEffect(() => {
    if (isLoaded && !hasOnboarded) {
      router.replace("/look/onboarding?returnTo=/look");
    }
  }, [isLoaded, hasOnboarded, router]);

  useEffect(() => {
    setHistoryId(new URLSearchParams(window.location.search).get("historyId"));
  }, []);

  useEffect(() => {
    if (historyId) {
      const historicalEntry = looks.find((entry) => entry.id === historyId);
      const historical = historicalEntry?.look ?? null;
      setGeneratedLook(historical);
      if (historical && recordedHistoryIdRef.current !== historyId) {
        recordedHistoryIdRef.current = historyId;
        recordViewedLook(historical);
      }
      return;
    }
    if (latestLook) setGeneratedLook(latestLook);
  }, [latestLook, looks, historyId, recordViewedLook]);

  useEffect(() => {
    if (!profile) return;
    // Prefer a fresh browser location when permission is already available.
    // If it is denied, the saved profile coordinates remain a safe fallback.
    setLocationStatus("locating");
    requestBrowserLocation()
      .then((coords) => {
        setCurrentCoordinates(coords);
        setLocationStatus("ready");
      })
      .catch(() => setLocationStatus(profile.location?.latitude != null ? "ready" : "denied"));
  }, [profile]);

  const activeCoordinates =
    currentCoordinates ??
    (profile?.location?.latitude != null && profile.location.longitude != null
      ? {
          latitude: profile.location.latitude,
          longitude: profile.location.longitude,
        }
      : null);

  const handleCreateLook = async () => {
    if (!profile || isGeneratingLook) return;
    setGenerateState("pending");
    // Root-level (survives navigation), not gated on isMountedRef below
    // — the button's pending state must reflect whether a generation is
    // actually still running, regardless of which page is on screen
    // when it starts or finishes.
    setIsGeneratingLook(true);

    const currentLocation: LookContextLocation | null = activeCoordinates
      ? {
          city: profile.location?.city ?? null,
          country: profile.location?.country ?? null,
          latitude: activeCoordinates.latitude,
          longitude: activeCoordinates.longitude,
          timezone: temporal.timezone,
        }
      : profile.location
        ? {
            city: profile.location.city,
            country: profile.location.country,
            latitude: profile.location.latitude,
            longitude: profile.location.longitude,
            timezone: profile.location.timezone ?? temporal.timezone,
          }
        : null;

    try {
      const res = await fetch("/api/look/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          locale,
          gender: lookGender,
          preferenceSignals: signals.slice(-30),
          current: {
            intent,
            occasion: intent,
            activity: intent,
            mood,
            freeText: freeText.trim() || null,
            location: currentLocation,
            budget: null,
            temporal,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIsGeneratingLook(false);
        if (isMountedRef.current) setGenerateState("error");
        return;
      }
      const look = data.look as GeneratedLook;
      // recordViewedLook (not recordLookHistory) so a freshly generated
      // look is immediately eligible for Overview's "Recently viewed"
      // list — that list filters on viewedAt being set, and generating
      // a look is exactly the kind of "just saw this" moment that
      // should count. This is also what makes navigating away mid-
      // generation and coming back later work: the entry lands in
      // history with a real viewedAt the instant it's ready, regardless
      // of whether this component is still mounted to see it.
      const saved = recordViewedLook(look);
      recordEvent({ type: "generate_look", lookId: saved.id ?? null, source: "look" });
      setIsGeneratingLook(false);
      if (!isMountedRef.current) return;
      setGeneratedLook(saved);
      setWeather((data.context?.weather as WeatherData | null) ?? null);
      setGenerateState("idle");
      // A newly generated look is now the latest look, not a historical one.
      if (historyId) {
        setHistoryId(null);
        router.replace("/look");
      }
    } catch {
      setIsGeneratingLook(false);
      if (isMountedRef.current) setGenerateState("error");
    }
  };

  const changeComponent = (index: number) => {
    if (!generatedLook) return;
    const component = generatedLook.components[index];
    if (!component || component.alternatives.length === 0) return;

    const [nextProduct, ...rest] = component.alternatives;
    const nextComponent = {
      ...component,
      productId: nextProduct.id,
      product: nextProduct,
      alternatives: [...rest, ...(component.product ? [component.product] : [])],
    };
    const components = generatedLook.components.map((item, itemIndex) =>
      itemIndex === index ? nextComponent : item,
    );
    const priced = components
      .map((item) => item.product)
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const next: GeneratedLook = {
      ...generatedLook,
      components,
      totalPrice: priced.length > 0 ? priced.reduce((sum, item) => sum + item.price, 0) : null,
      currency: priced[0]?.currency ?? generatedLook.currency,
    };
    setGeneratedLook(next);
    recordLookHistory(next);
  };

  const productSignal = (type: "like" | "dislike", product: NonNullable<GeneratedLook["components"][number]["product"]>) => {
    record(type, product);
  };

  // Batch-restore persisted like/dislike state for this look's
  // components in one request (section 5) whenever the rendered look
  // changes (new generation, or switching to a saved one via
  // historyId).
  useEffect(() => {
    if (!generatedLook) return;
    const ids = generatedLook.components
      .map((c) => c.product?.id)
      .filter((id): id is string => Boolean(id));
    if (ids.length > 0) ensureLoaded(ids);
  }, [generatedLook, ensureLoaded]);

  const handleProductSignalClick = (
    type: "like" | "dislike",
    product: NonNullable<GeneratedLook["components"][number]["product"]>,
  ) => {
    void toggle(product.id, type)
      .then((resulting) => {
        // Keep feeding the existing AI-context/behavioral log (section
        // 6) — only on a genuine like/dislike, not a toggle-off, since
        // that log has no "neutral" concept.
        if (resulting === type) productSignal(type, product);
      })
      .catch(() => {
        // Rollback already happened inside toggle(); nothing further
        // to do here for this call site.
      });
  };

  if (!isLoaded || !hasOnboarded || !profile) return null;

  return (
    <div className="flex flex-col px-5 pt-6 pb-10">
      <button
        type="button"
        onClick={() => {
          // A generated "Build a Look" flow has no historyId and should
          // return to the default Search/root view. Historical looks opened
          // from Explore/Overview keep normal browser-style back behavior
          // so the originating tab can restore its exact state.
          if (historyId) {
            router.back();
          } else {
            router.push("/");
          }
        }}
        aria-label={t("common.back")}
        className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-surface border border-border text-foreground"
      >
        <ChevronLeft size={18} strokeWidth={2} />
      </button>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-primary-foreground">
          <Sparkles size={14} strokeWidth={1.75} />
        </span>
        <h1 className="text-[19px] font-semibold tracking-tight text-foreground">
          {t("look.pageTitle")}
        </h1>
      </div>

      <LookProfileSummary editReturnTo="/look" />

      <div className="mt-5 rounded-2xl border border-border bg-surface px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CloudSun size={17} className="text-muted" />
            <div>
              <p className="text-[13px] font-medium text-foreground">
                {temporal.dayOfWeek} · {temporal.localTime}
              </p>
              <p className="text-[11.5px] text-muted">
                {temporal.season} · {temporal.timeOfDay}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <MapPin size={13} />
            <span>{profile.location?.city ?? t("look.locationUnavailable")}</span>
          </div>
        </div>
        {locationStatus === "denied" && (
          <p className="mt-2 text-[11.5px] text-muted">{t("look.locationPermissionHint")}</p>
        )}
        {weather && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
            <span>{Math.round(weather.temperature)}°C</span>
            <span>{t(`look.weather.${weather.condition}`)}</span>
            {weather.precipitationProbability != null && (
              <span>{weather.precipitationProbability}% {t("look.rainChance")}</span>
            )}
            {weather.windSpeed != null && <span>{Math.round(weather.windSpeed)} km/h</span>}
          </div>
        )}
      </div>

      <div className="mt-7">
        <h2 className="text-[15px] font-semibold text-foreground">{t("look.genderTitle")}</h2>
        <div className="mt-3 flex gap-2">
          {(["women", "men"] as const).map((gender) => (
            <OptionChip
              key={gender}
              label={t(`look.gender.${gender}`)}
              selected={lookGender === gender}
              onSelect={() => setLookGender(gender)}
            />
          ))}
        </div>
      </div>

      <div className="mt-7">
        <h2 className="text-[15px] font-semibold text-foreground">{t("look.intentTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {LOOK_INTENT_OPTIONS.map((id) => (
            <OptionChip
              key={id}
              label={t(`look.intent.${id}`)}
              selected={intent === id}
              onSelect={() => setIntent(intent === id ? null : id)}
            />
          ))}
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-[15px] font-semibold text-foreground">{t("look.vibeTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {MOOD_OPTIONS.map((id) => (
            <OptionChip
              key={id}
              label={t(`look.vibe.${id}`)}
              selected={mood === id}
              onSelect={() => setMood(mood === id ? null : id)}
            />
          ))}
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-[15px] font-semibold text-foreground">{t("look.freeTextTitle")}</h2>
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder={t("look.freeTextPlaceholder")}
          rows={3}
          className="mt-3 w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3.5 text-[16px] text-foreground placeholder:text-muted-soft outline-none focus:border-foreground/25"
        />
      </div>

      <button
        type="button"
        onClick={handleCreateLook}
        disabled={isGeneratingLook}
        className="mt-7 flex items-center justify-center rounded-full bg-primary px-6 py-3.5 text-[14px] font-medium text-primary-foreground transition-transform active:scale-95 disabled:opacity-60"
      >
        {isGeneratingLook ? t("look.creating") : t("look.createMyLook")}
      </button>

      {generateState === "error" && (
        <p className="mt-3 rounded-2xl bg-background px-4 py-3 text-[13px] text-muted leading-5">
          {t("look.generationError")}
        </p>
      )}

      {generatedLook && (
        <section className="mt-8">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                {t("look.yourLook")}
              </p>
              <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">
                {generatedLook.title}
              </h2>
              {generatedLook.description && (
                <p className="mt-2 max-w-[34rem] text-[13px] leading-5 text-muted">
                  {generatedLook.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {generatedLook.totalPrice != null && (
                <p className="text-[15px] font-semibold text-foreground">
                  {formatPrice(generatedLook.totalPrice, generatedLook.currency, currency, { maximumFractionDigits: 0 })}
                </p>
              )}
              {/* Save and Share sit on one horizontal line — previously
                  stacked vertically, which read as two unrelated
                  actions instead of a paired action row. */}
              <div className="flex items-center gap-2">
                {/* isSaved keys off generatedLook.id, which
                    recordViewedLook's normalization (see
                    lib/look/history.tsx) guarantees is always set by
                    the time this renders. */}
                {generatedLook.id && (
                  <button
                    type="button"
                    aria-pressed={isSaved(generatedLook.id)}
                    aria-label={isSaved(generatedLook.id) ? t("look.unsave") : t("look.save")}
                    onClick={() => toggleSaved(generatedLook)}
                    className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                      isSaved(generatedLook.id)
                        ? "border-foreground bg-foreground text-primary-foreground"
                        : "border-border bg-surface text-muted hover:text-foreground"
                    }`}
                  >
                    <Bookmark size={16} fill={isSaved(generatedLook.id) ? "currentColor" : "none"} />
                  </button>
                )}
                {generatedLook.id && (
                  <ShareButton
                    resolvePath={async () => {
                      const localId = generatedLook.id!;
                      const cached = shareIdsRef.current.get(localId);
                      if (cached) return `/look/${cached}`;
                      try {
                        const res = await fetch("/api/look/share", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ look: lookSnapshot(generatedLook) }),
                        });
                        if (!res.ok) return null;
                        const data = (await res.json()) as { lookId?: string };
                        if (!data.lookId) return null;
                        shareIdsRef.current.set(localId, data.lookId);
                        return `/look/${data.lookId}`;
                      } catch {
                        return null;
                      }
                    }}
                    shareTitle={generatedLook.title}
                  />
                )}
              </div>
            </div>
          </div>

          {generatedLook.styleNotes && generatedLook.styleNotes.length > 0 && (
            <div className="mt-4 rounded-2xl border border-border bg-surface px-4 py-3">
              <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted">{t("look.whyItWorks")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {generatedLook.styleNotes.map((note) => (
                  <span key={note} className="rounded-full bg-background px-3 py-1.5 text-[11.5px] text-foreground">{note}</span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            {generatedLook.components.map((component, index) => (
              <div key={`${component.role}-${component.searchQuery}`} className="flex h-full flex-col">
                <p className="mb-1.5 px-0.5 text-[10.5px] font-medium uppercase tracking-wide text-muted">
                  {component.role}
                </p>
                {component.product ? (
                  <div className="flex flex-1 flex-col">
                    <ProductCard product={component.product} source="look" />
                    {/* mt-auto (not a fixed mt-2) pins this row to the
                        bottom of the grid cell regardless of how tall
                        the card above it renders (title wrap, optional
                        shipping line, etc.) — grid's default
                        align-items: stretch already makes every cell
                        in a row match the tallest one, so this is what
                        keeps every "Change" row on the same horizontal
                        line across the row instead of trailing the
                        card's own variable content height. */}
                    <div className="mt-auto pt-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => changeComponent(index)}
                        disabled={component.alternatives.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-[11.5px] font-medium text-foreground disabled:opacity-40"
                      >
                        <RefreshCw size={13} />
                        Change
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Like this item"
                          aria-pressed={getSignal(component.product!.id) === "like"}
                          disabled={isPending(component.product!.id)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleProductSignalClick("like", component.product!);
                          }}
                          className={`flex h-8 w-8 items-center justify-center rounded-full border disabled:opacity-50 ${
                            getSignal(component.product!.id) === "like"
                              ? "border-foreground bg-foreground text-primary-foreground"
                              : "border-border bg-surface text-muted hover:text-foreground"
                          }`}
                        >
                          <ThumbsUp size={14} fill={getSignal(component.product!.id) === "like" ? "currentColor" : "none"} />
                        </button>
                        <button
                          type="button"
                          aria-label="Not for me"
                          aria-pressed={getSignal(component.product!.id) === "dislike"}
                          disabled={isPending(component.product!.id)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleProductSignalClick("dislike", component.product!);
                          }}
                          className={`flex h-8 w-8 items-center justify-center rounded-full border disabled:opacity-50 ${
                            getSignal(component.product!.id) === "dislike"
                              ? "border-foreground bg-foreground text-primary-foreground"
                              : "border-border bg-surface text-muted hover:text-foreground"
                          }`}
                        >
                          <ThumbsDown size={14} fill={getSignal(component.product!.id) === "dislike" ? "currentColor" : "none"} />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border bg-surface p-4 text-[12px] text-muted">
                    {component.searchQuery}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
