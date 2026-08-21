import "server-only";
import type { Coordinates } from "@/types/style";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

export class GeocodingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocodingProviderError";
  }
}

export interface ReverseGeocodeResult {
  city: string;
  country: string | null;
}

export interface CityGeocodeResult {
  city: string;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
}

export interface ReverseGeocodingService {
  reverseGeocode(coords: Coordinates): Promise<ReverseGeocodeResult>;
}

export interface CityGeocodingService {
  geocodeCity(city: string): Promise<CityGeocodeResult>;
}

class OpenMeteoCityGeocodingService implements CityGeocodingService {
  async geocodeCity(city: string): Promise<CityGeocodeResult> {
    const params = new URLSearchParams({
      name: city,
      count: "1",
      language: "en",
      format: "json",
    });
    let response: Response;
    try {
      response = await fetch(`${GEOCODING_URL}?${params.toString()}`, {
        next: { revalidate: 86400 },
      });
    } catch (err) {
      throw new GeocodingProviderError(
        `Could not reach Open-Meteo geocoding: ${err instanceof Error ? err.message : "network error"}`,
      );
    }
    if (!response.ok) {
      throw new GeocodingProviderError(`Open-Meteo geocoding returned HTTP ${response.status}.`);
    }
    const data = await response.json();
    const result = data?.results?.[0];
    if (!result) throw new GeocodingProviderError("City not found.");
    return {
      city: String(result.name),
      country: result.country ?? null,
      countryCode: result.country_code ?? null,
      latitude: Number(result.latitude),
      longitude: Number(result.longitude),
      timezone: result.timezone ?? null,
    };
  }
}

export const cityGeocodingService: CityGeocodingService =
  new OpenMeteoCityGeocodingService();

export async function geocodeCity(city: string): Promise<CityGeocodeResult> {
  return cityGeocodingService.geocodeCity(city);
}

// Reverse geocoding remains a separate future boundary. The main Look flow
// does not require reverse geocoding because it can use browser coordinates.
export async function reverseGeocode(_coords: Coordinates): Promise<ReverseGeocodeResult> {
  throw new GeocodingProviderError("Reverse geocoding is not configured.");
}
