import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import { engine } from './engine'
import type { Capsule, Day } from './types'

const pin = (label: string, bg: string) =>
  L.divIcon({ className: '', html: `<div class="tz-pin" style="background:${bg}">${label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] })

function Fit({ pts }: { pts: [number, number][] }) {
  const map = useMap()
  const key = JSON.stringify(pts)
  useEffect(() => {
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [36, 36] })
    else if (pts.length === 1) map.setView(pts[0], 13)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

/** Day route on real roads (OSRM geometry via the engine), numbered stops. */
export default function RouteMap({ capsule, day, highlight, className = '' }: { capsule: Capsule; day: Day; highlight?: string; className?: string }) {
  const [line, setLine] = useState<[number, number][] | null>(null)
  const stops = useMemo(() => day.blocks.filter((b) => b.kind !== 'leg' && b.lat && b.lon), [day])
  const sig = day.blocks.map((b) => b.id).join(',')
  useEffect(() => {
    let alive = true
    setLine(null)
    engine.route(capsule.id, day.index).then((r) => alive && setLine(r.line)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [capsule.id, day.index, sig])

  const stay: [number, number] = [capsule.stay.lat, capsule.stay.lon]
  const pts: [number, number][] = [stay, ...stops.map((b) => [b.lat!, b.lon!] as [number, number])]
  let n = 0
  return (
    <div className={`overflow-hidden rounded-2xl border border-edge ${className}`}>
      <MapContainer center={stay} zoom={12} className="h-full w-full" scrollWheelZoom={false} attributionControl>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · routes OSRM'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Fit pts={pts} />
        {line && <Polyline positions={line} pathOptions={{ color: '#2f54eb', weight: 5, opacity: 0.8 }} />}
        <Marker position={stay} icon={pin('⌂', '#0f1a3d')}>
          <Popup>Stay · {capsule.stay.name}</Popup>
        </Marker>
        {stops.map((b) => {
          const isPlace = b.kind === 'place'
          const label = isPlace ? String(++n) : b.kind === 'meal' ? '◆' : '●'
          const color = b.id === highlight ? '#ff6b4a' : isPlace ? '#2f54eb' : b.kind === 'meal' ? '#ff6b4a' : '#16a34a'
          return (
            <Marker key={b.id} position={[b.lat!, b.lon!]} icon={pin(label, color)}>
              <Popup>
                <b>{b.name}</b>
                <br />
                {b.start}–{b.end}
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}
