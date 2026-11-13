import { ArrowRight, CalendarArrowUp, Check, Clock, Plus, Repeat, Trash2, X } from 'lucide-react'
import type { Proposal } from './types'
import { Button, Eyebrow } from './ui'

/** Ripple Engine Diff Card: the re-planned rest of the day, before anything changes. */
export default function DiffSheet({ p, onAccept, onReject, busy, simulated }: { p: Proposal; onAccept: () => void; onReject: () => void; busy?: boolean; simulated?: boolean }) {
  const d = p.diff
  const empty = !d.dropped.length && !d.moved.length && !d.swapped.length && !d.shifted.length && !d.inserted.length && !d.notes.length
  return (
    <div className="fixed inset-0 z-[3000] flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Proposed re-plan">
      <div className="tz-rise max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-edge bg-surface-card p-6 shadow-modal">
        <div className="flex items-center justify-between">
          <Eyebrow className="tz-coral-text">Ripple Engine · {p.now}{simulated ? ' · simulated event' : ''}</Eyebrow>
          <span className="text-caption text-content-faint">Day {p.day + 1}</span>
        </div>
        <h3 className="mt-1 text-title font-bold text-content">{d.headline}</h3>
        <p className="mt-1 text-body text-content-muted">The rest of the day is already re-planned. Bookings stay fixed. Nothing changes until you accept.</p>

        <div className="mt-5 space-y-2.5 text-body text-content">
          {d.inserted.map((x) => <Row key={x} icon={<Plus className="h-4 w-4 text-success" />}>Added <b>{x}</b></Row>)}
          {d.swapped.map((s) => (
            <Row key={s.from + s.to} icon={<Repeat className="h-4 w-4 text-accent-on" />}>
              <b>{s.from}</b> <ArrowRight className="inline h-3.5 w-3.5 text-content-faint" /> <b>{s.to}</b> <span className="text-content-muted">· {s.reason}</span>
            </Row>
          ))}
          {d.moved.map((m) => <Row key={m.name} icon={<CalendarArrowUp className="h-4 w-4 text-warning" />}>Moved <b>{m.name}</b> to Day {m.to_day} <span className="text-content-muted">· {m.reason}</span></Row>)}
          {d.dropped.map((m) => <Row key={m.name} icon={<Trash2 className="h-4 w-4 text-danger" />}>Dropped <b>{m.name}</b> <span className="text-content-muted">· {m.reason}</span></Row>)}
          {d.notes.map((x) => <Row key={x} icon={<Check className="h-4 w-4 text-content-muted" />}>{x}</Row>)}
          {d.shifted.length > 0 && (
            <div className="rounded-2xl bg-surface-secondary p-3.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-caption font-semibold text-content-muted"><Clock className="h-3.5 w-3.5" />Re-timed ({d.shifted.length})</div>
              {d.shifted.map((s) => (
                <div key={s.name} className="flex justify-between gap-3 py-0.5 text-body">
                  <span className="truncate text-content-secondary">{s.name}</span>
                  <span className="shrink-0 tabular-nums text-content-muted">{s.from} → <b className="text-content">{s.to}</b></span>
                </div>
              ))}
            </div>
          )}
          {empty && <p className="text-content-muted">No changes needed. The plan still holds.</p>}
        </div>

        <div className="mt-5 grid grid-cols-2 divide-x divide-[var(--border-primary)] rounded-2xl border border-edge py-3 text-center">
          <Metric k="Feasibility" from={d.feasibility.before} to={d.feasibility.after} />
          <Metric k="Energy" from={d.energy.before} to={d.energy.after} suffix="%" invert />
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onReject} disabled={busy}><X className="h-4 w-4" />Keep original</Button>
          <Button className="flex-1" onClick={onAccept} disabled={busy}><Check className="h-4 w-4" />{busy ? 'Applying…' : 'Accept new plan'}</Button>
        </div>
      </div>
    </div>
  )
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-start gap-2.5">{icon}<span>{children}</span></div>
}

function Metric({ k, from, to, suffix = '', invert }: { k: string; from: number; to: number; suffix?: string; invert?: boolean }) {
  const better = invert ? to < from : to > from
  const same = to === from
  return (
    <div>
      <div className="text-caption text-content-muted">{k}</div>
      <div className="text-subtitle font-bold tabular-nums text-content">
        {from}{suffix} → <span className={same ? '' : better ? 'text-success' : 'text-danger'}>{to}{suffix}</span>
      </div>
    </div>
  )
}
