"use client";

import type { Coordinates, LookTemporalContext } from "@/types/style";

export type { Coordinates };

export type GeolocationErrorReason = "unsupported" | "denied" | "unavailable";

export class GeolocationRequestError extends Error {
  constructor(public reason: GeolocationErrorReason) {
    super(`geolocation_${reason}`);
  }
}

export function requestBrowserLocation(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new GeolocationRequestError("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (error) =>
        reject(
          new GeolocationRequestError(
            error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
          ),
        ),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

export function getBrowserTemporalContext(): LookTemporalContext {
  const now = new Date();
  const timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const hour = Number(localTime.slice(0, 2));
  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(now);

  const month = Number(localDate.slice(5, 7));
  const season =
    month <= 2 || month === 12
      ? "winter"
      : month <= 5
        ? "spring"
        : month <= 8
          ? "summer"
          : "autumn";

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
    timezone,
    dayOfWeek,
    isWeekend: dayOfWeek === "Saturday" || dayOfWeek === "Sunday",
    season,
    timeOfDay,
  };
}

export function formatCoordinates(coords: Coordinates): string {
  const lat = `${Math.abs(coords.latitude).toFixed(2)}°${coords.latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(coords.longitude).toFixed(2)}°${coords.longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
}
