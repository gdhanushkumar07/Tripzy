import L from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import type { Mode } from '../lib/types'
import type { GraphNode, Leg } from './engine'

const COLOR: Record<Mode, string> = {
  walk: '#64748b', auto: '#ca8a04', bike: '#ea580c', cab: '#7c3aed', citybus: '#dc2626', metro: '#2563eb', ibus: '#0f766e', train: '#1e293b',
}

/** Leaflet + OpenStreetMap, no API key. Straight lines between stops (sample data has no road shapes). */
export default function RouteMap({ legs, nodes }: { legs: Leg[]; nodes: Map<string, GraphNode> }) {
  const el = useRef<HTMLDivElement>(null)
  const [tileError, setTileError] = useState(false)

  useEffect(() => {
    if (!el.current) return
    const map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true })
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map)
    tiles.on('tileerror', () => setTileError(true))
    const pts: L.LatLngExpression[] = []
    for (const leg of legs) {
      const line = leg.stops.map((id) => nodes.get(id)).filter(Boolean).map((n) => [n!.lat, n!.lon] as [number, number])
      pts.push(...line)
      L.polyline(line, { color: COLOR[leg.mode], weight: 5, opacity: 0.85, dashArray: leg.mode === 'walk' ? '4 8' : undefined })
        .bindTooltip(`${leg.name}: ${leg.fromName} → ${leg.toName}`)
        .addTo(map)
    }
    const stops = [...new Set(legs.flatMap((l, i) => (i === 0 ? [l.from, l.to] : [l.to])))]
    stops.forEach((id, i) => {
      const n = nodes.get(id)
      if (!n) return
      L.circleMarker([n.lat, n.lon], { radius: i === 0 || i === stops.length - 1 ? 8 : 5, color: '#0f172a', fillColor: '#fff', fillOpacity: 1, weight: 2 })
        .bindTooltip(n.name)
        .addTo(map)
    })
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24] })
    return () => {
      map.remove()
    }
  }, [legs, nodes])

  return (
    <div>
      <div ref={el} className="h-64 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100" role="img" aria-label="Map of this route" />
      {tileError && (
        <p className="mt-2 text-sm text-amber-800" role="status">
          Map tiles could not load. The step-by-step list above is complete, and your locations are kept.
        </p>
      )}
    </div>
  )
}
