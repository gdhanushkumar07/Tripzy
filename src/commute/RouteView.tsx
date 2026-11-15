import { ExternalLink, Navigation, Sparkles } from 'lucide-react'
import { Component, lazy, Suspense, type ReactNode } from 'react'
import { MODE_ICON, MODE_LABEL, type Mode } from '../lib/types'
import { popupHtml, type MapLayer } from '../ui/LiveMap'
import { fmtDur, fmtTime, type Leg, type Route } from './engine'

const LiveMap = lazy(() => import('../ui/LiveMap'))

export type LiveLeg = Leg & {
  source?: string; estimate?: boolean; links?: { label: string; url: string }[]
  /** road/line shape; a compact "lat,lon;lat,lon" string once stored in Firestore (no nested arrays there) */
  geometry?: [number, number][] | string; color?: string; from_ll?: [number, number]; to_ll?: [number, number]
  /** other ways to finish from this stop, decided on the spot (next bus, auto, bike taxi, cab, walk) */
  alts?: { mode: Mode; minutes: number; fare: number; wait: number; arrive: number; via: string }[]
}
export type LiveRoute = Omit<Route, 'legs'> & { legs: LiveLeg[]; gmaps?: string }

export const MODE_COLOR: Record<Mode, string> = {
  walk: '#6c706a', cycle: '#4d7c0f', auto: '#ca8a04', erick: '#65a30d', bike: '#ea580c', cab: '#7c3aed', suv: '#6d28d9',
  citybus: '#dc2626', metro: '#2563eb', rail: '#0e7490', ferry: '#0891b2', ibus: '#315c4c', train: '#18211f', ownscooter: '#c2410c', owncar: '#1d4ed8',
}

const gTravel = (m: Mode) => (m === 'walk' ? 'walking' : m === 'cycle' ? 'bicycling' : ['metro', 'citybus', 'rail', 'train', 'ibus', 'ferry'].includes(m) ? 'transit' : m === 'bike' ? 'two-wheeler' : 'driving')
export const legDirections = (l: LiveLeg) =>
  l.from_ll && l.to_ll ? `https://www.google.com/maps/dir/?api=1&origin=${l.from_ll.join(',')}&destination=${l.to_ll.join(',')}&travelmode=${gTravel(l.mode)}` : undefined

/** If Leaflet or its chunk fails, show a message and keep the leg list usable. */
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <p role="status" className="rounded-2xl bg-warning-soft p-3 text-body text-warning">The map couldn't load. Use the step-by-step list — your locations are kept.</p>
    return this.props.children
  }
}

export function MapView({ layers, height }: { layers: MapLayer[]; height?: number }) {
  return (
    <MapBoundary>
      <Suspense fallback={<div className="h-72 animate-pulse rounded-2xl bg-surface-tertiary" aria-label="Loading map" />}>
        <LiveMap layers={layers} height={height} />
      </Suspense>
    </MapBoundary>
  )
}

export const decodeGeom = (g?: [number, number][] | string): [number, number][] | undefined =>
  typeof g === 'string' ? g.split(';').map((p) => p.split(',').map(Number) as [number, number]) : g
const encodeGeom = (g?: [number, number][] | string) =>
  Array.isArray(g) ? g.filter((_, i) => i % 2 === 0 || i === g.length - 1).map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join(';') : g
/** Make a live route safe for Firestore (no nested arrays). */
export const storable = <T extends { legs: LiveLeg[] }>(r: T): T => ({ ...r, legs: r.legs.map((l) => ({ ...l, geometry: encodeGeom(l.geometry) })) })

/** Map layers for a route: real road/line shape per leg, numbered stop at every change. */
export function routeLayers(legs: LiveLeg[], tint?: string): MapLayer[] {
  const layers: MapLayer[] = legs.map((l) => ({
    line: decodeGeom(l.geometry)?.length ? decodeGeom(l.geometry) : l.from_ll && l.to_ll ? [l.from_ll, l.to_ll] : undefined,
    color: tint ?? l.color ?? MODE_COLOR[l.mode], dashed: l.mode === 'walk',
  }))
  const pts = legs.flatMap((l, i) => {
    const out = []
    if (i === 0 && l.from_ll) out.push({ lat: l.from_ll[0], lon: l.from_ll[1], n: 'A', color: '#18211f', popup: popupHtml(l.fromName, [`Start · ${fmtTime(l.depart - l.wait)}`]) })
    if (l.to_ll) {
      const last = i === legs.length - 1
      out.push({
        lat: l.to_ll[0], lon: l.to_ll[1], n: last ? 'B' : i + 1, color: last ? '#d98955' : MODE_COLOR[l.mode],
        popup: popupHtml(l.toName, [`${MODE_LABEL[l.mode]} · arrive ${fmtTime(l.arrive)}`, `${fmtDur(l.minutes)} · ${l.km} km · ${l.fare ? `₹${l.fare}` : 'free'}`], legDirections(l) ? { href: legDirections(l)!, text: 'Directions for this leg' } : undefined),
      })
    }
    return out
  })
  return [...layers, { points: pts }]
}

export function LegList({ legs, who, showLinks = true }: { legs: LiveLeg[]; who?: string; showLinks?: boolean }) {
  return (
    <ol className="space-y-2" aria-label={who ? `${who}'s legs` : 'Legs'}>
      {legs.map((l, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="grid h-9 w-9 place-items-center rounded-full text-lg ring-4 ring-[var(--bg-card)]" style={{ background: `color-mix(in srgb, ${MODE_COLOR[l.mode]} 16%, transparent)` }} aria-hidden>{MODE_ICON[l.mode]}</span>
            {i < legs.length - 1 && <span className="w-px flex-1 border-s border-dashed border-[var(--tz-stone)]" />}
          </div>
          <div className="min-w-0 flex-1 pb-3">
            <p className="text-body font-semibold text-content">
              {i + 1}. {l.name}: {l.fromName} → {l.toName}
            </p>
            <p className="text-body text-content-muted">
              {fmtTime(l.depart)}–{fmtTime(l.arrive)} · {fmtDur(l.minutes)} · {l.km} km · {l.fare ? `₹${l.fare}${l.estimate ? ' (est.)' : ''}` : 'free'}
              {l.wait >= 1 && ` · wait ~${Math.round(l.wait)} min`}
              {l.peakDelay >= 3 && <span className="text-warning"> · +{l.peakDelay} min peak traffic</span>}
            </p>
            {l.note && <p className="mt-1 rounded-lg bg-warning-soft px-2 py-1 text-caption text-warning">⚠️ {l.note}</p>}
            {l.alts && l.alts.length > 1 && (
              <div className="mt-1.5 rounded-xl bg-surface-secondary p-2 text-caption">
                <p className="font-semibold text-content-secondary">Other ways from {l.fromName} (arriving {fmtTime(l.depart - l.wait)}):</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {l.alts.map((a) => (
                    <li key={a.mode} title={a.via} className={`rounded-full border px-2.5 py-0.5 ${a.mode === l.mode ? 'border-[var(--accent)] text-content' : 'border-edge text-content-secondary'}`}>
                      {MODE_ICON[a.mode]} {MODE_LABEL[a.mode]} · {fmtDur(a.minutes)} · {a.fare ? `₹${a.fare}` : 'free'}{a.wait >= 2 && ['citybus', 'metro'].includes(a.mode) ? ` · next in ${a.wait} min` : ''} · arrive {fmtTime(a.arrive)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {showLinks && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption">
                {legDirections(l) && (
                  <a href={legDirections(l)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2.5 py-0.5 font-medium text-accent-on hover:opacity-80">
                    <Navigation className="h-3 w-3" />Directions
                  </a>
                )}
                {(l.links ?? []).filter((x) => x.label !== 'Google Maps').slice(0, 4).map((x) => (
                  <a key={x.label} href={x.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-edge px-2.5 py-0.5 text-content-secondary hover:border-[var(--accent)]">
                    {x.label}<ExternalLink className="h-3 w-3" />
                  </a>
                ))}
                {l.source && <span className="text-content-faint">· {l.source}</span>}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

const BADGE: Record<string, string> = {
  Cheapest: 'bg-success-soft text-success',
  Fastest: 'bg-accent-subtle text-accent-on',
  'Most comfortable': 'tz-coral-pill',
  Recommended: 'bg-accent text-accent-text',
  'Public transport': 'bg-surface-secondary text-content-secondary',
}

export function RouteCard({ route, open, onToggle, onSave, saving }: {
  route: LiveRoute; open: boolean; onToggle: () => void; onSave?: () => void; saving?: boolean
}) {
  const visible = route.legs.filter((l) => l.name !== 'Walk (change)')
  return (
    <article className={`card flex flex-col ${open ? 'ring-2 ring-[var(--accent)] md:col-span-3' : ''}`}>
      <button className="text-left" onClick={onToggle} aria-expanded={open}>
        <div className="mb-2 flex flex-wrap gap-1">
          {route.labels.map((l) => <span key={l} className={`rounded-full px-2 py-0.5 text-xs font-bold ${BADGE[l]}`}>{l}</span>)}
        </div>
        <p className="mt-1 font-serif text-[40px] leading-none text-content">{fmtDur(route.totalMin)}</p>
        <p className="mt-1 text-body text-content-muted">
          ₹{route.fare} per person · {route.km} km · {route.changes} change{route.changes === 1 ? '' : 's'} · arrive {fmtTime(route.arrive)}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-1 text-lg" aria-label={visible.map((l) => MODE_LABEL[l.mode]).join(', then ')}>
          {visible.map((l, i, arr) => (
            <span key={i} title={l.name}>{MODE_ICON[l.mode]}{i < arr.length - 1 ? <span className="mx-0.5 text-xs text-content-faint">›</span> : null}</span>
          ))}
        </p>
        <p className="mt-3 flex gap-1.5 text-[15px] leading-relaxed text-content-secondary"><Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--tz-sun)]" /><span><span className="font-semibold text-content">Why this route:</span> {route.why}</span></p>
        <p className="mt-2 text-xs font-semibold text-content-muted">{open ? 'Hide details ▲' : 'Show legs, map and booking ▼'}</p>
      </button>
      {open && (
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div>
            <LegList legs={route.legs} />
            <div className="mt-3 flex flex-wrap gap-2">
              {onSave && <button className="btn" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : '☆ Save route'}</button>}
              {route.gmaps && <a className="btn-secondary" href={route.gmaps} target="_blank" rel="noreferrer"><Navigation className="h-4 w-4" />Open in Google Maps</a>}
            </div>
          </div>
          <MapView layers={routeLayers(route.legs)} />
        </div>
      )}
    </article>
  )
}
