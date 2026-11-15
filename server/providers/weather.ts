/** Live weather (16-day hourly forecast) and air quality from Open-Meteo — no key needed. */
import { cached, fetchJson, HOUR } from '../lib'

export type Hour = { time: string; temp: number; feels: number; rainProb: number; rainMm: number; code: number; uv: number; aqi?: number }
export type Weather = { tz: string; hours: Hour[]; days: { date: string; max: number; min: number; rainProb: number; code: number; sunrise: string; sunset: string }[]; source: string }

export function weather(lat: number, lon: number): Promise<Weather> {
  return cached(`wx:${lat.toFixed(2)},${lon.toFixed(2)}`, HOUR, async () => {
    const base = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&timezone=Asia%2FKolkata`
    const [f, aq] = await Promise.all([
      fetchJson<{ timezone: string; hourly: Record<string, (number | string)[]>; daily: Record<string, (number | string)[]> }>(
        `https://api.open-meteo.com/v1/forecast?${base}&forecast_days=16&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,uv_index&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset`),
      fetchJson<{ hourly: { time: string[]; us_aqi: (number | null)[] } }>(`https://air-quality-api.open-meteo.com/v1/air-quality?${base}&forecast_days=5&hourly=us_aqi`).catch(() => null),
    ])
    const aqiAt = new Map((aq?.hourly.time ?? []).map((t, i) => [t, aq!.hourly.us_aqi[i] ?? undefined]))
    const h = f.hourly
    return {
      tz: f.timezone,
      hours: (h.time as string[]).map((t, i) => ({
        time: t, temp: h.temperature_2m[i] as number, feels: h.apparent_temperature[i] as number,
        rainProb: (h.precipitation_probability[i] as number) ?? 0, rainMm: (h.precipitation[i] as number) ?? 0,
        code: h.weather_code[i] as number, uv: (h.uv_index[i] as number) ?? 0, aqi: aqiAt.get(t) ?? undefined,
      })),
      days: (f.daily.time as string[]).map((d, i) => ({
        date: d, max: f.daily.temperature_2m_max[i] as number, min: f.daily.temperature_2m_min[i] as number,
        rainProb: (f.daily.precipitation_probability_max[i] as number) ?? 0, code: f.daily.weather_code[i] as number,
        sunrise: f.daily.sunrise[i] as string, sunset: f.daily.sunset[i] as string,
      })),
      source: 'Open-Meteo',
    }
  })
}

export const WX_TEXT: Record<number, string> = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 80: 'Showers', 81: 'Showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
}
