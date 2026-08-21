import "server-only";
import type { LookTemporalContext } from "@/types/style";

// Same logic as lib/style/geolocation.ts's getBrowserTemporalContext,
// kept as a small separate copy rather than importing that file here:
// it's marked "use client" (for its unrelated navigator.geolocation
// call), and this needs to run in a route handler from a caller-supplied
// timezone rather than the server's own.
export function computeTemporalContext(timezone: string | null): LookTemporalContext {
  const tz = timezone || "UTC";
  const now = new Date();

  let localDate: string;
  let localTime: string;
  let dayOfWeek: string;
  try {
    localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now);
  } catch {
    // An invalid/unrecognized timezone string — fall back to UTC rather
    // than failing the whole Explore request over it.
    return computeTemporalContext("UTC");
  }

  const hour = Number(localTime.slice(0, 2));
  const month = Number(localDate.slice(5, 7));
  const season =
    month <= 2 || month === 12 ? "winter" : month <= 5 ? "spring" : month <= 8 ? "summer" : "autumn";
  const timeOfDay =
    hour >= 5 && hour < 12
      ? "morning"
      : hour >= 12 && hour < 17
        ? "afternoon"
        : hour >= 17 && hour < 22
          ? "evening"
          : "night";

  return {
    localDate,
    localTime,
    timezone: tz,
    dayOfWeek,
    isWeekend: dayOfWeek === "Saturday" || dayOfWeek === "Sunday",
    season,
    timeOfDay,
  };
}
