import "server-only";
import type { UserLocation, WeatherData } from "@/types/style";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

export class WeatherProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeatherProviderError";
  }
}

export interface WeatherService {
  getCurrentWeather(location: UserLocation): Promise<WeatherData>;
}

function mapWeatherCode(code: number | null): WeatherData["condition"] {
  if (code == null) return "unknown";
  if (code === 0) return "clear";
  if ([1, 2, 3].includes(code)) return "clouds";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "storm";
  return "unknown";
}

class OpenMeteoWeatherService implements WeatherService {
  async getCurrentWeather(location: UserLocation): Promise<WeatherData> {
    if (location.latitude == null || location.longitude == null) {
      throw new WeatherProviderError("Weather requires latitude and longitude.");
    }

    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current:
        "temperature_2m,apparent_temperature,precipitation,rain,snowfall,weather_code,wind_speed_10m",
      hourly: "precipitation_probability",
      daily: "sunrise,sunset",
      timezone: location.timezone || "auto",
      forecast_days: "1",
    });

    let response: Response;
    try {
      response = await fetch(`${OPEN_METEO_URL}?${params.toString()}`, {
        next: { revalidate: 900 },
      });
    } catch (err) {
      throw new WeatherProviderError(
        `Could not reach Open-Meteo: ${err instanceof Error ? err.message : "network error"}`,
      );
    }

    if (!response.ok) {
      throw new WeatherProviderError(`Open-Meteo returned HTTP ${response.status}.`);
    }

    const data = await response.json();
    const current = data?.current;
    if (!current) throw new WeatherProviderError("Open-Meteo returned no current weather.");

    const precipitationProbability =
      data?.hourly?.precipitation_probability?.[0] ?? null;

    return {
      temperature: Number(current.temperature_2m),
      feelsLike: Number(current.apparent_temperature),
      precipitationProbability:
        precipitationProbability == null ? null : Number(precipitationProbability),
      condition: mapWeatherCode(
        current.weather_code == null ? null : Number(current.weather_code),
      ),
      windSpeed:
        current.wind_speed_10m == null ? null : Number(current.wind_speed_10m),
      observedAt: String(current.time ?? new Date().toISOString()),
      precipitation:
        current.precipitation == null ? null : Number(current.precipitation),
      rain: current.rain == null ? null : Number(current.rain),
      snowfall: current.snowfall == null ? null : Number(current.snowfall),
      weatherCode:
        current.weather_code == null ? null : Number(current.weather_code),
      sunrise: data?.daily?.sunrise?.[0] ?? null,
      sunset: data?.daily?.sunset?.[0] ?? null,
      timezone: data?.timezone ?? location.timezone ?? null,
    };
  }
}

export const weatherService: WeatherService = new OpenMeteoWeatherService();

export async function getCurrentWeather(location: UserLocation): Promise<WeatherData> {
  return weatherService.getCurrentWeather(location);
}
