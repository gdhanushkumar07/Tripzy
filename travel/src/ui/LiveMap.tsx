import L from 'leaflet'
import { useEffect, useRef, useState } from 'react'

export type MapPoint = { lat: number; lon: number; label?: string; n?: number | string; color?: string; popup?: string }
export type MapLayer = { points?: MapPoint[]; line?: [number, number][]; color?: string; dashed?: boolean; weight?: number }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export const popupHtml = (title: string, lines: string[], link?: { href: string; text: string }) =>
  `<div style="font-family:var(--font-system);min-width:180px"><div style="font-family:var(--font-serif);font-size:18px;line-height:1.1;margin-bottom:4px">${esc(title)}</div>${lines.map((l) => `<div style="font-size:12px;color:#6c706a">${esc(l)}</div>`).join('')}${link ? `<a href="${link.href}" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:6px;font-size:12px;font-weight:600;color:#315c4c">${esc(link.text)} ↗</a>` : ''}</div>`

/** Leaflet + OpenStreetMap tiles (no key). Numbered markers with popups, route lines per layer. */
export default function LiveMap({ layers, height = 320 }: { layers: MapLayer[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const [tileError, setTileError] = useState(false)
  const sig = JSON.stringify(layers)

  useEffect(() => {
    if (!el.current) return
    const ls = JSON.parse(sig) as MapLayer[]
    const map = L.map(el.current, { scrollWheelZoom: false })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' })
      .on('tileerror', () => setTileError(true))
      .addTo(map)
    const all: L.LatLngExpression[] = []
    for (const layer of ls) {
      if (layer.line && layer.line.length > 1) {
        all.push(...layer.line)
        L.polyline(layer.line, { color: layer.color ?? '#315c4c', weight: layer.weight ?? 5, opacity: 0.85, dashArray: layer.dashed ? '5 9' : undefined }).addTo(map)
      }
      for (const p of layer.points ?? []) {
        all.push([p.lat, p.lon])
        const icon = L.divIcon({
          className: '',
          html: `<div style="display:grid;place-items:center;width:28px;height:28px;border-radius:9999px;background:${p.color ?? '#315c4c'};color:#fff;font:700 12px/1 Inter,sans-serif;border:3px solid #f7f5ef;box-shadow:0 2px 6px rgba(0,0,0,.3)">${p.n ?? ''}</div>`,
          iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14],
        })
        const m = L.marker([p.lat, p.lon], { icon, title: p.label }).addTo(map)
        if (p.popup) m.bindPopup(p.popup)
        else if (p.label) m.bindTooltip(p.label)
      }
    }
    if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [28, 28], maxZoom: 15 })
    else map.setView([22.5, 79], 4)
    return () => { map.remove() }
  }, [sig])

  return (
    <div>
      <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-2xl border border-edge bg-surface-tertiary" role="region" aria-label="Map" />
      {tileError && <p className="mt-2 text-caption text-warning" role="status">Map tiles could not load. The step-by-step list is complete and your places are kept.</p>}
    </div>
  )
}
