import { Sparkles } from 'lucide-react'
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
        <p role="status" className="rounded-xl bg-warning-soft p-3 text-sm text-warning">
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
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-tertiary" aria-label="Loading map" />}>
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
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-subtle text-lg ring-4 ring-[var(--bg-card)]" aria-hidden>{MODE_ICON[l.mode]}</span>
            {i < legs.length - 1 && <span className="w-px flex-1 border-s border-dashed border-[var(--tz-stone)]" />}
          </div>
          <div className="min-w-0 flex-1 pb-2">
            <p className="text-sm font-semibold">
              {l.name}: {l.fromName} → {l.toName}
            </p>
            <p className="text-sm text-content-muted">
              {fmtTime(l.depart)}–{fmtTime(l.arrive)} · {fmtDur(l.minutes)} · {l.km} km · {l.fare ? `₹${l.fare}` : 'free'}
              {l.wait >= 1 && ` · wait ~${Math.round(l.wait)} min`}
              {l.peakDelay >= 3 && <span className="text-warning"> · +{l.peakDelay} min peak traffic</span>}
            </p>
            {l.note && <p className="mt-1 rounded-lg bg-warning-soft px-2 py-1 text-xs text-warning">⚠️ {l.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

const BADGE: Record<string, string> = {
  Cheapest: 'bg-success-soft text-success',
  Fastest: 'bg-accent-subtle text-accent-on',
  'Fewest transfers': 'tz-coral-pill',
}

export function RouteCard({
  route, open, onToggle, nodes, onSave, saving,
}: {
  route: Route; open: boolean; onToggle: () => void; nodes: Map<string, GraphNode>; onSave?: () => void; saving?: boolean
}) {
  return (
    <article className={`card flex flex-col ${open ? 'ring-2 ring-[var(--accent)] md:col-span-3' : ''}`}>
      <button className="text-left" onClick={onToggle} aria-expanded={open}>
        <div className="mb-2 flex flex-wrap gap-1">
          {route.labels.map((l) => (
            <span key={l} className={`rounded-full px-2 py-0.5 text-xs font-bold ${BADGE[l]}`}>{l}</span>
          ))}
        </div>
        <p className="mt-1 font-serif text-[40px] leading-none text-content">{fmtDur(route.totalMin)}</p>
        <p className="text-sm text-content-muted">
          ₹{route.fare} · {route.km} km · {route.changes} change{route.changes === 1 ? '' : 's'} · arrive {fmtTime(route.arrive)}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-1 text-lg" aria-label={route.legs.map((l) => l.mode).join(', then ')}>
          {route.legs.filter((l) => l.name !== 'Walk (change)').map((l, i, arr) => (
            <span key={i} title={l.name}>{MODE_ICON[l.mode]}{i < arr.length - 1 ? <span className="mx-0.5 text-xs text-content-faint">›</span> : null}</span>
          ))}
        </p>
        <p className="mt-3 flex gap-1.5 text-[15px] leading-relaxed text-content-secondary"><Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--tz-sun)]" /><span><span className="font-semibold text-content">Why this route:</span> {route.why}</span></p>
        <p className="mt-2 text-xs font-semibold text-content-muted">{open ? 'Hide details ▲' : 'Show legs and map ▼'}</p>
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
