import { collection, limit, onSnapshot, orderBy, query } from '../lib/localstore'
import { ArrowRight, ArrowUpRight, CalendarDays, Luggage, Plus, Route as RouteIcon, Trash2, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { commuteUrl, type CommuteForm } from '../commute/CommutePage'
import type { GeoPoint } from '../lib/api'
import { useTaste } from '../lib/history'
import { useAuth } from '../lib/auth'
import { removeDoc, routeDoc, savePrefs, tripDoc } from '../lib/db'
import { db } from '../lib/firebase'
import { toFriendly } from '../lib/request'
import { ErrorBox, useAction, useStatus } from '../lib/status'
import { MODES, MODE_ICON, MODE_LABEL, type Fuel, type Mode, type Prefs, type Priority } from '../lib/types'
import { readLocalDraft } from '../lib/useDraft'
import { budgetError, optNum, transfersError } from '../lib/validate'
import type { TourDraft } from '../tour/TourPage'
import { Skeleton } from '../ui/kit'
import { YourData } from './YourData'
import { useDocumentScroll, useReveal } from '../ui/motion'
import { ALT_CITY_PHOTO, CITY_PHOTO, photoSrc } from '../ui/photos'

type SavedRoute = { id: string; from: string; to: string; fromPt?: GeoPoint; toPt?: GeoPoint; time: string; modes: Mode[]; budget: number | null; maxTransfers: number | null; people?: number; title: string; summary?: string }
const routeUrl = (r: SavedRoute) => (r.fromPt && r.toPt ? commuteUrl({ ...r, from: r.fromPt, to: r.toPt }) : '/commute')
type SavedTrip = { id: string; title: string; start?: string; city?: string; groupCode?: string; days?: unknown[] }

function useList<T>(uid: string, sub: 'routes' | 'trips', order: string) {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState('')
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'users', uid, sub), orderBy(order, 'desc'), limit(20)),
        (s) => { setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }) as T)); setError('') },
        (e) => setError(toFriendly(e).message),
      ),
    [uid, sub, order],
  )
  return { items, error }
}

const greeting = () => {
  const h = new Date().getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
const fmtDate = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

/** Signed-in home, in the original Tripzy journal style. */
export default function Dashboard() {
  const { user, profile } = useAuth()
  const uid = user!.uid
  const nav = useNavigate()
  const root = useRef<HTMLDivElement>(null)
  const { confirm, toast } = useStatus()
  const routes = useList<SavedRoute>(uid, 'routes', 'createdAt')
  const trips = useList<SavedTrip>(uid, 'trips', 'updatedAt')
  useDocumentScroll()
  useReveal(root, [routes.items === null, trips.items === null])

  const commuteDraft = readLocalDraft<CommuteForm>(uid, 'commute')?.value
  const tourDraft = readLocalDraft<TourDraft>(uid, 'tour')?.value
  const answered = tourDraft ? Object.values(tourDraft.answers).filter((v) => (Array.isArray(v) ? v.length : v !== undefined && v !== '')).length : 0
  const showCommute = !!(commuteDraft?.touched && commuteDraft.from && typeof commuteDraft.from === 'object')
  const taste = useTaste(uid)
  const showTour = answered > 0 && !tourDraft?.doneTripId

  const del = async (kind: 'route' | 'trip', id: string, title: string) => {
    if (!(await confirm(`Delete "${title}"? This can't be undone.`))) return
    try {
      await removeDoc(kind === 'route' ? routeDoc(uid, id) : tripDoc(uid, id))
      toast('Deleted', 'success')
    } catch (e) {
      toast(toFriendly(e).message, 'error')
    }
  }

  return (
    <div ref={root} className="mx-auto max-w-[1280px] px-5 pb-24 pt-10 md:px-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div data-reveal className="tz-chapter">Every journey begins somewhere.</div>
          <h1 data-reveal className="tz-h1 mt-2 text-content">{greeting()}, {profile.name || 'traveller'}.</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/commute" className="inline-flex h-12 items-center gap-2 rounded-full border border-edge bg-surface-card px-6 text-[15px] font-semibold text-content transition hover:bg-surface-hover"><RouteIcon className="h-4 w-4" />Plan a commute</Link>
          <Link to="/tour" className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-[15px] font-semibold text-accent-text transition hover:bg-accent-hover"><Plus className="h-4 w-4" />Plan a journey</Link>
        </div>
      </header>

      {(showCommute || showTour) && (
        <section className="mt-10 overflow-hidden rounded-[30px] bg-[#18211F] text-white" aria-label="Continue where you left off">
          <div className="grid md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="relative min-h-[220px]">
              <img src={photoSrc(CITY_PHOTO[tourDraft?.answers.city ?? ''] ?? 'golconda')} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#18211F] via-[#18211F]/30 to-transparent md:bg-gradient-to-r md:from-transparent md:to-[#18211F]/60" />
              <div className="absolute bottom-6 left-6 right-6">
                <span className="rounded-full bg-white/15 px-3 py-1 text-[12px] font-medium backdrop-blur-md">Saved draft</span>
                <h2 className="mt-3 font-serif text-[40px] leading-[0.95] md:text-[52px]">Continue where you left off</h2>
              </div>
            </div>
            <div className="flex flex-col justify-center gap-4 p-6 md:p-10">
              {showCommute && commuteDraft && (
                <Link to={commuteDraft.groupCode ? `/commute?group=${commuteDraft.groupCode}` : commuteDraft.from && commuteDraft.to ? commuteUrl({ ...commuteDraft, from: commuteDraft.from, to: commuteDraft.to }) : '/commute'} className="group block border-b border-white/10 pb-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D98955]">Daily Traveller</div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[17px]">
                    {commuteDraft.from?.name}{commuteDraft.to ? ` → ${commuteDraft.to.name}` : ''}
                    <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
                  </div>
                </Link>
              )}
              {showTour && (
                <Link to={tourDraft?.groupCode ? `/tour?group=${tourDraft.groupCode}` : '/tour'} className="group block">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D98955]">Tourist Planner</div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[17px]">
                    {answered} of 13 questions answered
                    <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
                  </div>
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#D98955]" style={{ width: `${(answered / 12) * 100}%` }} /></div>
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="mt-10 grid gap-5 md:grid-cols-2" aria-label="Choose a module">
        <ModuleCard
          to="/commute" photo="hussain-sagar" kicker="Daily Traveller" title="Get there smarter"
          text="Cheapest, fastest and fewest-transfer routes that mix metro, bus, auto and more. Solo, or as a group that splits up on the way."
          icon={<RouteIcon className="h-4 w-4" />} cta="Plan a commute"
        />
        <ModuleCard
          to="/tour" photo="charminar" kicker="Tourist Planner" title="A trip shaped around you"
          text="Twelve quick questions, then a day-by-day plan with costs you can edit. Plan alone or with friends."
          icon={<Luggage className="h-4 w-4" />} cta="Plan a journey"
        />
      </section>

      {taste && taste.summary.length > 0 && (
        <section className="mt-14 rounded-[22px] border border-edge bg-surface-card p-6" aria-labelledby="taste">
          <div className="tz-kicker">Personalised for you</div>
          <h2 id="taste" className="tz-h3 mt-2 text-content">What Tripzy has learned</h2>
          <ul className="mt-3 space-y-1 text-[15px] text-content-secondary">{taste.summary.map((t) => <li key={t}>· {t}</li>)}</ul>
          <p className="mt-3 text-caption text-content-faint">From {taste.events} actions in your own history (kept, removed and swapped stops, saved routes). New plans rank places with these weights, and each boosted stop says why.</p>
        </section>
      )}

      <section className="mt-20" aria-labelledby="journeys">
        <SectionHead id="journeys" kicker="My journeys" title="Your saved trips" />
        {trips.error ? <div className="mt-6"><ErrorBox message={trips.error} /></div> : trips.items === null ? (
          <div className="mt-8 space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : !trips.items.length ? (
          <p className="mt-6 max-w-md text-[15px] text-content-muted">No trips yet. <Link to="/tour" className="text-accent-on underline underline-offset-2">Answer the 13 questions</Link> and your first one appears here.</p>
        ) : (
          <ul data-reveal data-reveal-stagger className="mt-8 border-t border-edge">
            {trips.items.map((t) => {
              const photo = t.city && CITY_PHOTO[t.city] ? photoSrc(CITY_PHOTO[t.city], true) : photoSrc(ALT_CITY_PHOTO.hyderabad, true)
              return (
                <li key={t.id} className="group grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-5 border-b border-edge py-5 md:grid-cols-[120px_minmax(0,1fr)_200px_auto]">
                  <button type="button" onClick={() => nav(`/tour/${t.id}`)} className="aspect-[4/3] overflow-hidden rounded-xl bg-surface-tertiary" aria-label={`Open ${t.title}`}>
                    <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                  </button>
                  <button type="button" onClick={() => nav(`/tour/${t.id}`)} className="min-w-0 text-start">
                    <div className="truncate font-serif text-[24px] leading-tight text-content md:text-[28px]">{t.title}</div>
                    <div className="mt-1 text-[13px] text-content-muted md:hidden">{t.start ? fmtDate(t.start) : t.groupCode ? 'Group trip' : ''}</div>
                  </button>
                  <div className="hidden text-[14px] text-content-muted md:block">
                    {t.groupCode ? <><Users className="me-1.5 inline h-3.5 w-3.5" />Group trip</> : <><CalendarDays className="me-1.5 inline h-3.5 w-3.5" />{fmtDate(t.start)}</>}
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => void del('trip', t.id, t.title)} aria-label={`Delete ${t.title}`} className="grid h-9 w-9 place-items-center rounded-full text-content-faint transition hover:bg-danger-soft hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                    <button type="button" onClick={() => nav(`/tour/${t.id}`)} aria-label={`Open ${t.title}`}><ArrowUpRight className="h-5 w-5 text-content-faint transition group-hover:text-content" /></button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="mt-20 grid gap-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-20">
        <section aria-labelledby="routes">
          <SectionHead id="routes" kicker="Saved routes" title="One tap to go again" />
          {routes.error ? <div className="mt-6"><ErrorBox message={routes.error} /></div> : routes.items === null ? (
            <div className="mt-8 space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : !routes.items.length ? (
            <p className="mt-6 max-w-md text-[15px] text-content-muted">No saved routes yet. <Link to="/commute" className="text-accent-on underline underline-offset-2">Find a route</Link> and tap “Save route”.</p>
          ) : (
            <ol data-reveal data-reveal-stagger className="mt-8">
              {routes.items.map((r) => (
                <li key={r.id} className="group flex items-center gap-4 border-b border-edge py-4">
                  <RouteIcon className="h-4 w-4 shrink-0 text-[var(--tz-sun)]" />
                  <button type="button" className="min-w-0 flex-1 text-start" onClick={() => nav(routeUrl(r))}>
                    <div className="truncate text-[16px] text-content">{r.title} <span className="text-content-muted">· {r.time}</span></div>
                    {r.summary && <div className="mt-0.5 truncate text-[13px] text-content-muted">{r.summary}</div>}
                  </button>
                  <button type="button" onClick={() => void del('route', r.id, r.title)} aria-label={`Delete ${r.title}`} className="grid h-9 w-9 place-items-center rounded-full text-content-faint transition hover:bg-danger-soft hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  <button type="button" onClick={() => nav(routeUrl(r))} aria-label={`Open ${r.title}`}><ArrowUpRight className="h-5 w-5 text-content-faint transition group-hover:text-content" /></button>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section aria-labelledby="prefs">
          <SectionHead id="prefs" kicker="Your preferences" title="How you like to travel" />
          <PrefsForm key={JSON.stringify(profile.prefs)} name={profile.name} prefs={profile.prefs} uid={uid} />
        </section>
        <section aria-labelledby="your-data">
          <SectionHead id="your-data" kicker="Your data" title="What Tripzy keeps for you" />
          <YourData />
        </section>
      </div>

      <footer className="mt-20 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-edge pt-6 text-[13px] text-content-muted">
        <span>Live data: OpenStreetMap, Wikipedia, Open-Meteo and city transit timetables. Fares marked “est.” are estimates.</span>
        <Link to="/credits" className="hover:text-content">Photo credits</Link>
      </footer>
    </div>
  )
}

function SectionHead({ id, kicker, title }: { id: string; kicker: string; title: string }) {
  return (
    <div data-reveal>
      <div className="tz-kicker">{kicker}</div>
      <h2 id={id} className="tz-h3 mt-2 text-content">{title}</h2>
    </div>
  )
}

function ModuleCard({ to, photo, kicker, title, text, icon, cta }: {
  to: string; photo: Parameters<typeof photoSrc>[0]; kicker: string; title: string; text: string; icon: React.ReactNode; cta: string
}) {
  return (
    <Link to={to} className="group relative block min-h-[380px] overflow-hidden rounded-[30px] bg-[#18211F] text-white">
      <img src={photoSrc(photo)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80 transition duration-700 group-hover:scale-[1.04]" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#18211F] via-[#18211F]/55 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-7 md:p-9">
        <div className="tz-chapter !text-[#D98955]">{kicker}</div>
        <h3 className="mt-2 font-serif text-[40px] leading-[1] md:text-[48px]">{title}</h3>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/80">{text}</p>
        <span className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-[#F7F5EF] px-5 text-[14px] font-semibold text-[#18211F]">
          {icon}{cta}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </span>
      </div>
    </Link>
  )
}

function PrefsForm({ uid, name, prefs }: { uid: string; name: string; prefs: Prefs }) {
  const { toast } = useStatus()
  const [modes, setModes] = useState<Mode[]>(prefs.modes)
  const [budget, setBudget] = useState(prefs.budget?.toString() ?? '')
  const [maxT, setMaxT] = useState(prefs.maxTransfers?.toString() ?? '')
  const [err, setErr] = useState('')
  const [fam, setFam] = useState(prefs.family ?? { adults: 1, children: 0, seniors: 0 })
  const [priority, setPriority] = useState<Priority>(prefs.priority ?? 'balanced')
  const [hasCar, setHasCar] = useState(!!prefs.vehicles?.car)
  const [carKmpl, setCarKmpl] = useState(String(prefs.vehicles?.car?.kmpl ?? 15))
  const [fuel, setFuel] = useState<Fuel>(prefs.vehicles?.car?.fuel ?? 'petrol')
  const [seats, setSeats] = useState(String(prefs.vehicles?.car?.seats ?? 5))
  const [hasScooter, setHasScooter] = useState(!!prefs.vehicles?.scooter)
  const [scKmpl, setScKmpl] = useState(String(prefs.vehicles?.scooter?.kmpl ?? 45))
  const saveAction = useAction(async () => {
    const kmpl = Number(carKmpl), sk = Number(scKmpl), st = Number(seats)
    const e = budgetError(optNum(budget)) || transfersError(optNum(maxT)) || (!modes.length ? 'Pick at least one mode.' : '')
      || (hasCar && !(kmpl >= 3 && kmpl <= 60) ? 'Car mileage should be between 3 and 60 km per litre.' : '')
      || (hasCar && !(st >= 2 && st <= 9) ? 'Car seats should be between 2 and 9.' : '')
      || (hasScooter && !(sk >= 10 && sk <= 120) ? 'Scooter mileage should be between 10 and 120 km per litre.' : '')
      || (fam.adults + fam.seniors < 1 ? 'At least one adult travels.' : '')
    setErr(e)
    if (e) return
    const vehicles = { ...(hasCar ? { car: { kmpl, fuel, seats: st } } : {}), ...(hasScooter ? { scooter: { kmpl: sk } } : {}) }
    const res = await savePrefs(uid, name, { ...prefs, modes, budget: optNum(budget), maxTransfers: optNum(maxT), vehicles, family: fam, priority, asked: Date.now() })
    toast(res === 'local' ? 'Preferences saved on this device — will sync when online' : 'Preferences saved', 'success')
  })
  return (
    <div data-reveal className="mt-8">
      <p className="text-[14px] text-content-muted">Preselects modes on the Daily Traveller form and answers most journey questions for you.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {MODES.map((m) => {
          const on = modes.includes(m)
          return (
            <button key={m} type="button" aria-pressed={on} className={`chip ${on ? 'chip-on' : 'chip-off'}`} onClick={() => setModes(on ? modes.filter((x) => x !== m) : [...modes, m])}>
              <span aria-hidden>{MODE_ICON[m]}</span>{MODE_LABEL[m]}
            </button>
          )
        })}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="pbudget">Default budget (₹)</label>
          <input id="pbudget" className="tz-input" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))} placeholder="No limit" />
        </div>
        <div>
          <label className="label" htmlFor="pmax">Max transfers</label>
          <input id="pmax" className="tz-input" inputMode="numeric" value={maxT} onChange={(e) => setMaxT(e.target.value.replace(/[^\d]/g, ''))} placeholder="Any" />
        </div>
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-3">
        <div>
          <span className="label">Usually travelling</span>
          {(['adults', 'children', 'seniors'] as const).map((k) => (
            <label key={k} className="mt-1 flex items-center justify-between gap-2 text-body capitalize">{k}
              <input type="number" min={0} max={9} className="tz-input !h-9 !w-20" value={fam[k]} onChange={(e) => setFam({ ...fam, [k]: Math.max(0, Math.min(9, Number(e.target.value) || 0)) })} />
            </label>
          ))}
        </div>
        <div>
          <label className="label" htmlFor="ppri">What matters most</label>
          <select id="ppri" className="tz-input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="balanced">Best balance</option><option value="fastest">Time</option><option value="cheapest">Money</option><option value="comfort">Comfort</option>
          </select>
          <p className="mt-2 text-caption text-content-faint">Journeys ask only who is travelling, luggage and this — the rest comes from here.</p>
        </div>
        <div className="space-y-2">
          <span className="label">Your vehicles</span>
          <label className="flex items-center gap-2 text-body"><input type="checkbox" checked={hasCar} onChange={(e) => setHasCar(e.target.checked)} />I have a car</label>
          {hasCar && (
            <div className="grid grid-cols-3 gap-2">
              <input aria-label="Car mileage km per litre" className="tz-input !h-9" inputMode="decimal" value={carKmpl} onChange={(e) => setCarKmpl(e.target.value.replace(/[^\d.]/g, ''))} title="km per litre" />
              <select aria-label="Fuel" className="tz-input !h-9" value={fuel} onChange={(e) => setFuel(e.target.value as Fuel)}><option value="petrol">Petrol</option><option value="diesel">Diesel</option><option value="cng">CNG</option><option value="ev">Electric</option></select>
              <input aria-label="Seats" className="tz-input !h-9" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/[^\d]/g, ''))} title="seats" />
            </div>
          )}
          <label className="flex items-center gap-2 text-body"><input type="checkbox" checked={hasScooter} onChange={(e) => setHasScooter(e.target.checked)} />I have a scooter / bike</label>
          {hasScooter && <input aria-label="Scooter mileage km per litre" className="tz-input !h-9" inputMode="decimal" value={scKmpl} onChange={(e) => setScKmpl(e.target.value.replace(/[^\d.]/g, ''))} />}
          <p className="text-caption text-content-faint">Mileage in km per litre: fuel cost for park-and-ride and road trips.</p>
        </div>
      </div>
      {err && <p className="field-error">{err}</p>}
      <button className="btn mt-5" onClick={() => void saveAction.run()} disabled={saveAction.busy}>{saveAction.busy ? 'Saving…' : 'Save preferences'}</button>
      {saveAction.error && <div className="mt-3"><ErrorBox message={saveAction.error} onRetry={() => void saveAction.retry()} /></div>}
    </div>
  )
}
