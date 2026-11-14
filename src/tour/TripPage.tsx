import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Car, Footprints, Repeat, Sparkles, Trash2, Users, Utensils } from 'lucide-react'
import { PlaceImage } from '../ui/kit'
import { CITY_PHOTO, photoSrc } from '../ui/photos'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../lib/auth'
import { setGroup, tripDoc, write } from '../lib/db'
import { db } from '../lib/firebase'
import { toFriendly } from '../lib/request'
import { ErrorBox, SaveStatus, Skeleton, useStatus, useUnsavedWarning, type SaveState } from '../lib/status'
import { useGroup } from '../lib/useGroup'
import {
  alternatives, CITIES, dayTotal, fmt, moveStop, placeById, removeStop, stopTotal, swapStop, tripTotal, type Place, type Trip,
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

  const wrap = 'mx-auto max-w-[1100px] px-5 pb-24 pt-10 md:px-10'
  if (!remote.loaded) return <div className={wrap}><Skeleton lines={5} /></div>
  if (remote.error && !trip) return <div className={wrap}><ErrorBox message={remote.error} onRetry={() => window.location.reload()}><Link className="btn-secondary" to="/">Dashboard</Link></ErrorBox></div>
  if (!trip) {
    return (
      <div className={wrap}>
        <div className="rounded-[22px] border border-dashed border-edge p-8 text-center">
          <h1 className="font-serif text-[32px] text-content">Trip not found</h1>
          <p className="mx-auto mt-2 max-w-sm text-body text-content-muted">It may have been deleted, or the group plan has not been created yet.</p>
          <div className="mt-5 flex justify-center gap-2"><Link className="btn" to="/tour">Plan a trip</Link><Link className="btn-secondary" to="/">Dashboard</Link></div>
        </div>
      </div>
    )
  }

  const total = tripTotal(trip)
  const budget = trip.budgetPerDay ? trip.budgetPerDay * trip.days.length : null
  const status: SaveState = save.state !== 'idle' ? save : remote.pending ? { state: navigator.onLine ? 'saving' : 'local' } : { state: 'idle' }
  const hero = CITY_PHOTO[trip.city] ?? 'charminar'

  return (
    <div className={wrap}>
      <Link to="/tour" className="inline-flex items-center gap-1 text-body text-content-muted hover:text-content"><ArrowLeft className="h-4 w-4" />Questions</Link>

      <article className="mt-4 overflow-hidden rounded-[30px] bg-[#18211F] text-white">
        <div className="grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="relative min-h-[280px] lg:min-h-[380px]">
            <img src={photoSrc(hero)} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#18211F] via-[#18211F]/30 to-transparent lg:bg-gradient-to-r lg:from-transparent lg:to-[#18211F]/40" />
            <div className="absolute left-6 top-6 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/15 px-3 py-1 text-[12px] font-medium backdrop-blur-md">{trip.source === 'ai' ? 'AI plan' : 'Basic plan · rule-based'}</span>
              <span className="rounded-full bg-[#D98955] px-3 py-1 text-[12px] font-semibold text-[#18211F]">Sample data</span>
              {remote.groupCode && <span className="rounded-full bg-white/15 px-3 py-1 text-[12px] font-medium backdrop-blur-md">Shared live with the group</span>}
            </div>
            <div className="absolute bottom-6 left-6 right-6">
              <h1 className="font-serif text-[44px] leading-[0.95] md:text-[60px]">{trip.title}</h1>
              <p className="mt-2 text-[15px] text-white/80">{CITIES[trip.city]?.name} · from {fmtDate(trip.start)} · {trip.party} {trip.party === 1 ? 'person' : 'people'}</p>
            </div>
          </div>
          <div className="flex flex-col justify-between gap-8 p-6 md:p-10">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">Per person</div>
                <div className="mt-1 font-serif text-[48px] leading-none" aria-label="Trip total per person">{rupees(total)}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">Days</div>
                <div className="mt-1 font-serif text-[48px] leading-none">{trip.days.length}</div>
              </div>
            </div>
            {budget ? (
              <div>
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-white/60">Budget {rupees(budget)}</span>
                  <span className={total > budget ? 'font-semibold text-[#f3a08a]' : 'font-semibold text-[#D98955]'}>
                    {total > budget ? `${rupees(total - budget)} over` : `${rupees(budget - total)} under`}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={total} aria-label="Budget used">
                  <div className={`h-full rounded-full ${total > budget ? 'bg-[#f3a08a]' : 'bg-[#D98955]'}`} style={{ width: `${Math.min(100, (total / budget) * 100)}%` }} />
                </div>
              </div>
            ) : <p className="text-[13px] text-white/60">No budget limit set.</p>}
            <div className="text-[13px] [&_*]:!text-white/70"><SaveStatus status={status} onRetry={() => void persist(trip)} /></div>
          </div>
        </div>
      </article>

      {trip.days.map((day, di) => (
        <section key={day.date} className="mt-14" aria-label={`Day ${di + 1}`}>
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-edge pb-4">
            <div>
              <div className="tz-kicker">Day {di + 1}</div>
              <h2 className="tz-h3 mt-1 text-content">{fmtDate(day.date)}</h2>
            </div>
            <p className="text-[15px] text-content-muted"><span className="font-serif text-[26px] text-content">{rupees(dayTotal(day))}</span>{trip.budgetPerDay ? ` / ${rupees(trip.budgetPerDay)}` : ''}</p>
          </div>
          {!day.stops.length && <p className="mt-6 text-body text-content-muted">Free day — nothing planned.</p>}
          <ol className="relative mt-2">
            <span aria-hidden className="absolute bottom-3 top-3 w-px bg-[var(--border-primary)]" style={{ insetInlineStart: 79.5 }} />
            {day.stops.map((s, si) => {
              const key = `${di}-${si}`
              const p = placeById(s.placeId)
              const isMeal = s.kind === 'meal'
              const n = day.stops.slice(0, si + 1).filter((x) => x.kind === 'visit').length
              const alts: Place[] = swapping === key ? alternatives(trip, di, si) : []
              return (
                <li key={`${s.placeId}-${si}`} className="relative">
                  {s.travel && (
                    <div className="grid grid-cols-[56px_32px_minmax(0,1fr)] gap-x-2">
                      <span />
                      <span className="flex justify-center"><span className="my-1 h-full border-s border-dashed border-[var(--tz-stone)]" /></span>
                      <div className="flex flex-wrap items-center gap-x-3 py-1.5 text-[12px] text-content-muted">
                        <span className="inline-flex items-center gap-1.5 text-content-secondary">
                          {s.travel.fare ? <><Car className="h-3.5 w-3.5" />Auto · {s.travel.min} min · {s.travel.km} km · {rupees(s.travel.fare)}</> : <><Footprints className="h-3.5 w-3.5" />Walk · {s.travel.min} min</>}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-[56px_32px_minmax(0,1fr)] gap-x-2 py-3">
                    <div className="pt-0.5 text-end leading-tight tabular-nums">
                      <div className="font-serif text-[21px] text-content">{fmt(s.start)}</div>
                      <div className="text-[11px] text-content-faint">{fmt(s.end)}</div>
                    </div>
                    <div className="relative flex justify-center pt-1.5">
                      <span className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold ring-4 ring-[var(--bg-primary)] ${isMeal ? 'bg-[var(--tz-sun)] text-[#18211F]' : 'bg-accent text-accent-text'}`}>
                        {isMeal ? <Utensils className="h-3.5 w-3.5" /> : n}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <h3 className={`${isMeal ? 'text-[16px] font-semibold' : 'font-serif text-[24px] leading-tight'} text-content`}>{s.name}</h3>
                            {isMeal && <span className="text-[12px] text-[var(--tz-coral)]">Meal</span>}
                            {p?.diet === 'veg' && <span className="text-[12px] text-success">veg</span>}
                          </div>
                          <p className="mt-1.5 flex gap-1.5 text-[15px] leading-relaxed text-content-secondary">
                            <Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--tz-sun)]" /><span>{s.why}</span>
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-content-muted">
                            <span>{p ? `${p.dwell} min` : ''}{p && !isMeal ? ` · ${p.indoor ? 'Indoor' : 'Outdoor'}` : ''} · {s.cost ? rupees(s.cost) : 'Free entry'}{s.travel?.fare ? ` · with travel ${rupees(stopTotal(s))}` : ''}</span>
                          </div>
                          {!!s.who?.length && remote.groupCode && (
                            <p className="mt-2"><span className="tz-coral-pill inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-medium"><Users className="h-3 w-3" />Wanted by {s.who.join(', ')}</span></p>
                          )}
                          {s.warn && <div className="mt-2 flex gap-1.5 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{s.warn}</div>}
                          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
                            <IconBtn label={`Move ${s.name} up`} disabled={si === 0} onClick={() => edit(moveStop(trip, di, si, -1))}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                            <IconBtn label={`Move ${s.name} down`} disabled={si === day.stops.length - 1} onClick={() => edit(moveStop(trip, di, si, 1))}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                            <button type="button" aria-expanded={swapping === key} onClick={() => setSwapping(swapping === key ? null : key)}
                              className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface-card px-2.5 py-1 font-medium text-content-secondary transition hover:border-[var(--accent)] hover:text-accent-on">
                              <Repeat className="h-3 w-3" />Swap
                            </button>
                            <button type="button" onClick={() => edit(removeStop(trip, di, si), trip, `Removed ${s.name}`)}
                              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-content-muted transition hover:bg-danger-soft hover:text-danger">
                              <Trash2 className="h-3 w-3" />Remove
                            </button>
                          </div>
                          {swapping === key && (
                            <div className="tz-rise mt-3 grid gap-2 sm:grid-cols-3" data-swap>
                              {alts.length ? alts.map((a) => (
                                <button key={a.id} type="button" onClick={() => { setSwapping(null); edit(swapStop(trip, di, si, a), trip, `Swapped ${s.name} for ${a.name}`) }}
                                  className="rounded-2xl border border-edge bg-surface-card p-3 text-start text-[12px] transition hover:border-[var(--accent)]">
                                  <div className="text-[14px] font-semibold text-content">{a.name}</div>
                                  <div className="mt-1 text-content-muted">{a.cost ? rupees(a.cost) : 'free'} · {a.dwell} min</div>
                                  <div className="mt-1 line-clamp-2 text-content-secondary">{a.desc}</div>
                                </button>
                              )) : <p className="text-body text-content-muted">No other place fits this time slot.</p>}
                            </div>
                          )}
                        </div>
                        {!isMeal && <PlaceImage id={s.placeId} cat={p?.cat} alt={s.name} className="hidden aspect-[4/3] w-[168px] shrink-0 rounded-2xl sm:block" />}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      <p className="mt-14 border-t border-edge pt-6 text-[13px] text-content-muted">
        Sample data: opening hours, prices and travel times are estimates from a curated list and should be checked before you travel. Place photos via Wikipedia · <Link to="/credits" className="hover:text-content">credits</Link>
      </p>
    </div>
  )
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-full border border-edge bg-surface-card text-content-secondary transition hover:border-[var(--accent)] hover:text-accent-on disabled:opacity-30">
      {children}
    </button>
  )
}
