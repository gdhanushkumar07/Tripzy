"""Weather from Open-Meteo (free, no key). Dates beyond the 16-day forecast
horizon fall back to seasonal norms, and the source is labelled."""

from __future__ import annotations

import httpx

SEASONAL = {  # rough monthly norms: (tmax C, rain prob %)
    "hyderabad": [(29, 5), (32, 5), (36, 5), (38, 10), (39, 15), (34, 55), (30, 70), (30, 70),
                  (31, 60), (31, 35), (29, 15), (28, 5)],
    "jaipur": [(22, 5), (26, 5), (32, 5), (38, 5), (41, 10), (39, 30), (34, 60), (32, 60),
               (33, 35), (33, 5), (29, 5), (24, 5)],
}


def forecast(city_key: str, lat: float, lon: float, dates: list[str]) -> dict:
    out = {}
    try:
        r = httpx.get("https://api.open-meteo.com/v1/forecast", timeout=10, params={
            "latitude": lat, "longitude": lon, "timezone": "Asia/Kolkata", "forecast_days": 16,
            "daily": "temperature_2m_max,precipitation_probability_max,weathercode",
            "hourly": "precipitation_probability"})
        data = r.json()
        daily = data["daily"]
        hourly = data["hourly"]
        for i, d in enumerate(daily["time"]):
            if d in dates:
                hrs = [v or 0 for t, v in zip(hourly["time"], hourly["precipitation_probability"])
                       if t.startswith(d)]
                out[d] = {"tmax": daily["temperature_2m_max"][i],
                          "rain_prob": daily["precipitation_probability_max"][i] or 0,
                          "hourly": hrs if len(hrs) == 24 else None, "source": "Open-Meteo forecast"}
    except Exception:
        pass
    for d in dates:
        if d not in out:
            m = int(d[5:7]) - 1
            tmax, rp = SEASONAL.get(city_key, SEASONAL["hyderabad"])[m]
            out[d] = {"tmax": tmax, "rain_prob": rp, "hourly": None, "source": "Seasonal average"}
    return out
