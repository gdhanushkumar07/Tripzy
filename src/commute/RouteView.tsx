import { Component, lazy, Suspense, type ReactNode } from 'react'
import { MODE_ICON } from '../lib/types'
import { fmtDur, fmtTime, type GraphNode, type Leg, type Route } from './engine'

const RouteMap = lazy(() => import('./RouteMap'))

/** If Leaflet or its chunk fails, show a message and keep the leg list usable. */
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          The map couldn't load. Use the step-by-step list above — your locations are kept.
        </p>
      )
    }
    return this.props.children
  }
}

export function MapView({ legs, nodes }: { legs: Leg[]; nodes: Map<string, GraphNode> }) {
  return (
    <MapBoundary>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-slate-200" aria-label="Loading map" />}>
        <RouteMap legs={legs} nodes={nodes} />
      </Suspense>
    </MapBoundary>
  )
}

export function LegList({ legs, who }: { legs: Leg[]; who?: string }) {
  return (
    <ol className="space-y-2" aria-label={who ? `${who}'s legs` : 'Legs'}>
      {legs.map((l, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-lg" aria-hidden>{MODE_ICON[l.mode]}</span>
            {i < legs.length - 1 && <span className="w-0.5 flex-1 bg-slate-200" />}
          </div>
          <div className="min-w-0 flex-1 pb-2">
            <p className="text-sm font-semibold">
              {l.name}: {l.fromName} → {l.toName}
            </p>
            <p className="text-sm text-slate-600">
              {fmtTime(l.depart)}–{fmtTime(l.arrive)} · {fmtDur(l.minutes)} · {l.km} km · {l.fare ? `₹${l.fare}` : 'free'}
              {l.wait >= 1 && ` · wait ~${Math.round(l.wait)} min`}
              {l.peakDelay >= 3 && <span className="text-amber-700"> · +{l.peakDelay} min peak traffic</span>}
            </p>
            {l.note && <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">⚠️ {l.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

const BADGE: Record<string, string> = {
  Cheapest: 'bg-emerald-100 text-emerald-900',
  Fastest: 'bg-blue-100 text-blue-900',
  'Fewest transfers': 'bg-violet-100 text-violet-900',
}

export function RouteCard({
  route, open, onToggle, nodes, onSave, saving,
}: {
  route: Route; open: boolean; onToggle: () => void; nodes: Map<string, GraphNode>; onSave?: () => void; saving?: boolean
}) {
  return (
    <article className={`card flex flex-col ${open ? 'ring-2 ring-brand-600 md:col-span-3' : ''}`}>
      <button className="text-left" onClick={onToggle} aria-expanded={open}>
        <div className="mb-2 flex flex-wrap gap-1">
          {route.labels.map((l) => (
            <span key={l} className={`rounded-full px-2 py-0.5 text-xs font-bold ${BADGE[l]}`}>{l}</span>
          ))}
        </div>
        <p className="text-2xl font-bold">{fmtDur(route.totalMin)}</p>
        <p className="text-sm text-slate-600">
          ₹{route.fare} · {route.km} km · {route.changes} change{route.changes === 1 ? '' : 's'} · arrive {fmtTime(route.arrive)}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-1 text-lg" aria-label={route.legs.map((l) => l.mode).join(', then ')}>
          {route.legs.filter((l) => l.name !== 'Walk (change)').map((l, i, arr) => (
            <span key={i} title={l.name}>{MODE_ICON[l.mode]}{i < arr.length - 1 ? <span className="mx-0.5 text-xs text-slate-400">›</span> : null}</span>
          ))}
        </p>
        <p className="mt-2 text-sm font-medium text-brand-800">Why this route: {route.why}</p>
        <p className="mt-2 text-xs font-semibold text-slate-500">{open ? 'Hide details ▲' : 'Show legs and map ▼'}</p>
      </button>
      {open && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <LegList legs={route.legs} />
            {onSave && (
              <button className="btn mt-3" onClick={onSave} disabled={saving}>
                {saving ? 'Saving…' : '☆ Save route'}
              </button>
            )}
          </div>
          <MapView legs={route.legs} nodes={nodes} />
        </div>
      )}
    </article>
  )
}
