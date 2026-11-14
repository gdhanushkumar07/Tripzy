import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../lib/auth'
import { setGroup, tripDoc, write } from '../lib/db'
import { db } from '../lib/firebase'
import { toFriendly } from '../lib/request'
import { ErrorBox, SaveStatus, Skeleton, useStatus, useUnsavedWarning, type SaveState } from '../lib/status'
import { useGroup } from '../lib/useGroup'
import {
  alternatives, CITIES, dayTotal, fmt, moveStop, removeStop, stopTotal, swapStop, tripTotal, type Place, type Trip,
} from './generate'

const fmtDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** Load a trip either from users/{uid}/trips/{id} or, for g_CODE, from the shared group result (live). */
function useTrip(tripId: string) {
  const { user } = useAuth()
  const groupCode = tripId.startsWith('g_') ? tripId.slice(2) : null
  const { group, error: groupError } = useGroup<Trip & { at?: number }>(groupCode)
  const [own, setOwn] = useState<{ trip: Trip | null; pending: boolean; error: string; loaded: boolean }>({ trip: null, pending: false, error: '', loaded: false })

  useEffect(() => {
    if (groupCode || !user) return
    return onSnapshot(
      tripDoc(user.uid, tripId),
      { includeMetadataChanges: true },
      (snap) => setOwn({ trip: (snap.data() as Trip) ?? null, pending: snap.metadata.hasPendingWrites, error: '', loaded: snap.exists() || !snap.metadata.fromCache }),
      (e) => setOwn((s) => ({ ...s, error: toFriendly(e).message, loaded: true })),
    )
  }, [user, tripId, groupCode])

  // Keep a pointer in the member's own trips so the dashboard can reopen a group trip.
  const pointed = useRef(false)
  useEffect(() => {
    if (!groupCode || !user || !group?.result || pointed.current) return
    pointed.current = true
    void write(() => setDoc(doc(db, 'users', user.uid, 'trips', tripId), { title: `${group.result!.title} (group)`, groupCode, updatedAt: Date.now() })).catch(() => undefined)
  }, [groupCode, user, group, tripId])

  if (groupCode) {
    return { trip: (group?.result as Trip | null) ?? null, pending: false, error: groupError, loaded: !!group || !!groupError, groupCode, members: group?.memberUids.length ?? 1 }
  }
  return { ...own, groupCode: null, members: 1 }
}

export default function TripPage() {
  const { tripId = '' } = useParams()
  const { user } = useAuth()
  const { toast } = useStatus()
  const remote = useTrip(tripId)
  const [local, setLocal] = useState<Trip | null>(null)
  const [dirty, setDirty] = useState(false)
  const [save, setSave] = useState<SaveState>({ state: 'idle' })
  const [swapping, setSwapping] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const trip = dirty && local ? local : remote.trip
  useUnsavedWarning(dirty)

  const persist = useCallback(async (t: Trip) => {
    if (!user) return
    setSave({ state: 'saving' })
    try {
      const res = remote.groupCode
        ? await setGroup(remote.groupCode, { result: { ...t, at: (t as Trip & { at?: number }).at ?? Date.now() } })
        : await write(() => setDoc(tripDoc(user.uid, tripId), t), `trip:${tripId}`)
      setSave(res === 'local' ? { state: 'local' } : { state: 'saved', at: Date.now() })
    } catch (e) {
      setSave({ state: 'error' })
      toast(toFriendly(e).message, 'error') // the save status shows a Retry button
    } finally {
      setDirty(false)
    }
  }, [user, remote.groupCode, tripId, toast])

  /** Apply an edit: totals recalculate at once, the save follows a moment later. */
  const edit = (next: Trip, undo?: Trip, msg?: string) => {
    setLocal(next)
    setDirty(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void persist(next), 600)
    if (undo && msg) toast(msg, 'info', { label: 'Undo', run: () => edit(undo) })
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!remote.loaded) return <div className="mx-auto max-w-3xl"><Skeleton lines={5} /></div>
  if (remote.error && !trip) return <div className="mx-auto max-w-3xl"><ErrorBox message={remote.error} onRetry={() => window.location.reload()}><Link className="btn-secondary" to="/">Dashboard</Link></ErrorBox></div>
  if (!trip) {
    return (
      <div className="mx-auto max-w-3xl card">
        <h1 className="text-lg font-semibold">Trip not found</h1>
        <p className="mt-1 text-sm text-slate-600">It may have been deleted, or the group plan hasn't been created yet.</p>
        <div className="mt-3 flex gap-2"><Link className="btn" to="/tour">Plan a trip</Link><Link className="btn-secondary" to="/">Dashboard</Link></div>
      </div>
    )
  }

  const total = tripTotal(trip)
  const budget = trip.budgetPerDay ? trip.budgetPerDay * trip.days.length : null
  const status: SaveState = save.state !== 'idle' ? save : remote.pending ? { state: navigator.onLine ? 'saving' : 'local' } : { state: 'idle' }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500"><Link to="/tour" className="btn-link">← Questions</Link></p>
          <h1 className="text-2xl font-bold">{trip.title}</h1>
          <p className="text-sm text-slate-600">
            {CITIES[trip.city]?.name} · from {fmtDate(trip.start)} · {trip.party} {trip.party === 1 ? 'person' : 'people'}
            {' · '}<span className="sample">Sample data</span>{' '}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{trip.source === 'ai' ? 'AI plan' : 'Basic plan (rule-based)'}</span>
            {remote.groupCode && <span className="ml-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-900">Shared live with the group</span>}
          </p>
        </div>
        <SaveStatus status={status} onRetry={() => void persist(trip)} />
      </div>

      <section className="card" aria-label="Trip cost">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-sm text-slate-600">Trip total per person (tickets, food, local travel)</p>
            <p className="text-2xl font-bold">{rupees(total)}</p>
          </div>
          {budget && (
            <p className={`text-sm font-semibold ${total > budget ? 'text-red-700' : 'text-brand-800'}`}>
              {total > budget ? `${rupees(total - budget)} over` : `${rupees(budget - total)} under`} your budget of {rupees(budget)}
            </p>
          )}
        </div>
        {budget && (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={total} aria-label="Budget used">
            <div className={`h-full ${total > budget ? 'bg-red-600' : 'bg-brand-600'}`} style={{ width: `${Math.min(100, (total / budget) * 100)}%` }} />
          </div>
        )}
      </section>

      {trip.days.map((day, di) => (
        <section key={day.date} className="card" aria-label={`Day ${di + 1}`}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Day {di + 1} · {fmtDate(day.date)}</h2>
            <p className="text-sm font-semibold">{rupees(dayTotal(day))}{trip.budgetPerDay ? <span className="font-normal text-slate-500"> / {rupees(trip.budgetPerDay)}</span> : null}</p>
          </div>
          {!day.stops.length && <p className="text-sm text-slate-500">Free day — nothing planned.</p>}
          <ol className="space-y-1">
            {day.stops.map((s, si) => {
              const key = `${di}-${si}`
              const alts: Place[] = swapping === key ? alternatives(trip, di, si) : []
              return (
                <li key={`${s.placeId}-${si}`}>
                  {s.travel && (
                    <p className="ml-14 py-1 text-xs text-slate-500">
                      {s.travel.fare ? `🛺 Auto ${s.travel.min} min · ${s.travel.km} km · ${rupees(s.travel.fare)}` : `🚶 Walk ${s.travel.min} min`}
                    </p>
                  )}
                  <div className="flex gap-3 rounded-xl border border-slate-100 p-3">
                    <div className="w-11 shrink-0 text-sm font-semibold text-slate-700">{fmt(s.start)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{s.kind === 'meal' ? '🍽️ ' : ''}{s.name}</p>
                      <p className="text-xs text-slate-500">{fmt(s.start)}–{fmt(s.end)} · {s.cost ? rupees(s.cost) : 'Free entry'}{s.travel?.fare ? ` · with travel ${rupees(stopTotal(s))}` : ''}</p>
                      <p className="mt-1 text-sm text-slate-600">{s.why}</p>
                      {!!s.who?.length && remote.groupCode && (
                        <p className="mt-1 text-xs"><span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-900">Wanted by {s.who.join(', ')}</span></p>
                      )}
                      {s.warn && <p className="mt-1 text-xs font-medium text-amber-800">⚠️ {s.warn}</p>}
                      <div className="mt-2 flex flex-wrap gap-1">
                        <button className="btn-secondary min-h-9 px-3 py-1" aria-label={`Move ${s.name} up`} disabled={si === 0} onClick={() => edit(moveStop(trip, di, si, -1))}>↑</button>
                        <button className="btn-secondary min-h-9 px-3 py-1" aria-label={`Move ${s.name} down`} disabled={si === day.stops.length - 1} onClick={() => edit(moveStop(trip, di, si, 1))}>↓</button>
                        <button className="btn-secondary min-h-9 px-3 py-1" aria-expanded={swapping === key} onClick={() => setSwapping(swapping === key ? null : key)}>Swap</button>
                        <button className="btn-secondary min-h-9 px-3 py-1 text-red-700" onClick={() => edit(removeStop(trip, di, si), trip, `Removed ${s.name}`)}>Remove</button>
                      </div>
                      {swapping === key && (
                        <div className="mt-2 space-y-1 rounded-xl bg-slate-50 p-2">
                          {alts.length ? alts.map((p) => (
                            <button key={p.id} className="block w-full rounded-lg p-2 text-left text-sm hover:bg-white" onClick={() => { setSwapping(null); edit(swapStop(trip, di, si, p), trip, `Swapped ${s.name} for ${p.name}`) }}>
                              <strong>{p.name}</strong> · {p.cost ? rupees(p.cost) : 'free'} · {p.dwell} min
                              <span className="block text-xs text-slate-500">{p.desc}</span>
                            </button>
                          )) : <p className="p-2 text-sm text-slate-500">No other place fits this time slot.</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      <p className="text-xs text-slate-500">
        Sample data: opening hours, prices and travel times are estimates from a curated list and should be checked before you travel.
      </p>
    </div>
  )
}
