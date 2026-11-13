import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { api } from "../lib/api";
import type { Capsule, Day } from "../lib/types";

const pin = (label: string, color: string) =>
  L.divIcon({ className: "", html: `<div class="tz-pin" style="background:${color}">${label}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });

function Fit({ pts }: { pts: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
    else if (pts.length === 1) map.setView(pts[0], 13);
  }, [map, JSON.stringify(pts)]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function MapView({ capsule, day, highlight }: { capsule: Capsule; day: Day; highlight?: string }) {
  const [line, setLine] = useState<[number, number][] | null>(null);
  const stops = useMemo(() => day.blocks.filter((b) => b.kind !== "leg" && b.lat && b.lon), [day]);
  useEffect(() => {
    let alive = true;
    setLine(null);
    api.route(capsule.id, day.index).then((r) => alive && setLine(r.line)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [capsule.id, day.index, JSON.stringify(day.blocks.map((b) => b.id))]); // eslint-disable-line react-hooks/exhaustive-deps

  const stay: [number, number] = [capsule.stay.lat, capsule.stay.lon];
  const pts: [number, number][] = [stay, ...stops.map((b) => [b.lat!, b.lon!] as [number, number])];
  let n = 0;
  return (
    <MapContainer center={stay} zoom={12} className="h-full w-full rounded-2xl" scrollWheelZoom={false}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit pts={pts} />
      {line && <Polyline positions={line} pathOptions={{ color: "#2447d4", weight: 4, opacity: 0.75 }} />}
      <Marker position={stay} icon={pin("🏨", "#121527")}>
        <Popup>Stay: {capsule.stay.name}</Popup>
      </Marker>
      {stops.map((b) => {
        const isPlace = b.kind === "place";
        const label = isPlace ? String(++n) : b.kind === "meal" ? "🍽" : "☕";
        const color = b.id === highlight ? "#e0287d" : isPlace ? "#2447d4" : "#6b7089";
        return (
          <Marker key={b.id} position={[b.lat!, b.lon!]} icon={pin(label, color)}>
            <Popup>
              <b>{b.name}</b>
              <br />
              {b.start}–{b.end}
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
