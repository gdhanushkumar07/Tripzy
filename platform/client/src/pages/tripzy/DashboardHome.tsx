import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  Activity, ArrowRight, Brain, CalendarCheck, CalendarClock, CloudRain, Compass, Dna, FileUp, FlaskConical, Globe2,
  Luggage, MapPinned, Plus, Radio, Sparkles, Train, Users,
} from 'lucide-react'
import PageShell from '../../components/Layout/PageShell'
import { tripsApi } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import { engine, type CapsuleSummary, type DiscoverItem, type Profile } from '../../tripzy/engine'
import type { CapsuleX } from '../../tripzy/types'
import { Card, Eyebrow, Pill, PlaceImage, ScoreRing, Skeleton, usePlacePhoto } from '../../tripzy/ui'

type Trip = { id: number; title: string; start_date: string | null; end_date: string | null; cover_image?: string | null; day_count?: number; place_count?: number; shared_count?: number; is_archived?: number }

const today = () => new Date().toISOString().slice(0, 10)
const daysUntil = (d: string) => Math.ceil((new Date(d + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime()) / 86400000)
const greeting = () => {
  const h = new Date().getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function DashboardHome(): React.ReactElement {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user) as { username?: string } | null
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [caps, setCaps] = useState<CapsuleSummary[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [disc, setDisc] = useState<DiscoverItem[]>([])
  const [next, setNext] = useState<CapsuleX | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    tripsApi.list().then((r: { trips: Trip[] }) => setTrips(r.trips ?? [])).catch(() => (setTrips([]), setErr('Could not load your trips.')))
    engine.myCapsules().then(setCaps).catch(() => undefined)
    engine.profile().then((p) => {
      setProfile(p)
      let asked = false
      try { asked = sessionStorage.getItem('tripzy:onboard-asked') === '1' } catch { /* ignore */ }
      if (!p.completed && !asked) {
        try { sessionStorage.setItem('tripzy:onboard-asked', '1') } catch { /* ignore */ }
        nav('/onboarding')
      }
    }).catch(() => undefined)
    engine.discover(undefined, 6).then((d) => setDisc(d.items)).catch(() => undefined)
  }, [nav])

  const capByTrip = useMemo(() => new Map(caps.filter((c) => c.platform_trip_id).map((c) => [c.platform_trip_id!, c])), [caps])
  const isDemo = (t: Trip) => !!capByTrip.get(t.id)?.demo
  const real = (trips ?? []).filter((t) => !isDemo(t) && !t.is_archived)
  const upcomingAll = (trips ?? []).filter((t) => !t.is_archived && t.end_date && t.end_date >= today())
    .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))
  const upcoming = upcomingAll.find((t) => !isDemo(t)) ?? upcomingAll[0]
  const completed = real.filter((t) => t.end_date && t.end_date < today())
  const visited = new Set(completed.map((t) => capByTrip.get(t.id)?.city).filter(Boolean))
  const nextCap = upcoming ? capByTrip.get(upcoming.id) : undefined

  useEffect(() => {
    if (nextCap) engine.capsule(nextCap.id).then(setNext).catch(() => setNext(null))
    else setNext(null)
  }, [nextCap?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const activity = useMemo(() => {
    const rows: { at: string; icon: React.ElementType; text: string; sub: string; to?: string; demo?: boolean }[] = []
    for (const c of caps) {
      rows.push({ at: c.created_at, icon: Sparkles, text: `Planned ${c.city}, ${c.days} days`, sub: c.demo ? 'Demo trip' : `Feasibility ${c.scores.join(' · ')}`, to: c.platform_trip_id ? `/trips/${c.platform_trip_id}/intel` : undefined, demo: c.demo })
      for (const r of c.ripple_log) rows.push({ at: c.created_at, icon: Activity, text: r.diff.headline, sub: `${c.city} · Day ${r.day + 1} · ${r.now}${c.demo ? ' · simulated' : ''}`, to: c.platform_trip_id ? `/trips/${c.platform_trip_id}/intel` : undefined, demo: c.demo })
      for (const l of c.learned) rows.push({ at: c.created_at, icon: Brain, text: l.text, sub: `Learned from ${l.from}`, demo: c.demo })
    }
    return rows.slice(0, 7)
  }, [caps])

  return (
    <PageShell background="var(--bg-primary)">
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
        {/* greeting */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight text-content sm:text-[32px]">{greeting()}, {user?.username ?? 'traveller'}.</h1>
            <p className="mt-1 text-body text-content-muted">
              {profile?.completed
                ? <>Planning with your Travel DNA: <span className="text-content-secondary">{profile.summary?.slice(0, 3).join(' · ')}</span></>
                : <>Finish your <Link to="/onboarding" className="font-semibold text-accent-on">Travel DNA</Link> so every plan fits you.</>}
            </p>
          </div>
          <Link to="/plan" className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-body font-semibold text-accent-text hover:bg-accent-hover"><Sparkles className="h-4 w-4" />Plan a trip</Link>
        </div>
        {err && <div className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-body text-danger">{err} <button type="button" className="underline" onClick={() => window.location.reload()}>Retry</button></div>}

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* upcoming journey */}
          {trips === null ? <Skeleton className="h-[300px]" /> : upcoming ? (
            <UpcomingCard trip={upcoming} cap={nextCap} capsule={next} demo={isDemo(upcoming)} />
          ) : (
            <Card className="flex flex-col items-center justify-center p-10 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-subtle text-accent-on"><Luggage className="h-7 w-7" /></span>
              <h2 className="mt-4 text-title font-bold text-content">Your next adventure starts here.</h2>
              <p className="mt-1 max-w-sm text-body text-content-muted">Describe a trip in one sentence and Tripzy builds a verified, energy-aware plan around you.</p>
              <Link to="/plan" className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-6 text-body font-semibold text-accent-text"><Plus className="h-4 w-4" />Create your first trip</Link>
            </Card>
          )}

          {/* quick actions + stats */}
          <div className="grid gap-5">
            <Card className="p-5">
              <Eyebrow className="mb-3">Quick actions</Eyebrow>
              <div className="grid grid-cols-2 gap-2">
                <Quick to="/plan" icon={Sparkles} label="Plan a trip" />
                <Quick to="/atlas" icon={Compass} label="Explore destinations" />
                <Quick to={upcoming ? `/trips/${upcoming.id}/intel` : '/plan'} icon={FileUp} label="Add tickets & bookings" />
                <Quick to="/dna" icon={Dna} label="View Travel DNA" />
              </div>
            </Card>
            <Card className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4 lg:grid-cols-2">
              <Stat icon={Globe2} value={trips === null ? '–' : real.length} label="Total trips" />
              <Stat icon={CalendarClock} value={trips === null ? '–' : real.filter((t) => t.end_date && t.end_date >= today()).length} label="Upcoming" />
              <Stat icon={CalendarCheck} value={trips === null ? '–' : completed.length} label="Completed" />
              <Stat icon={MapPinned} value={trips === null ? '–' : visited.size} label="Cities visited" />
            </Card>
          </div>
        </div>

        {/* alerts */}
        <TravelAlerts capsule={next} tripId={upcoming?.id} />

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* discovery */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <Eyebrow>Picked for your Travel DNA</Eyebrow>
              <Link to="/plan" className="text-caption font-semibold text-accent-on">Plan around these →</Link>
            </div>
            {disc.length === 0 ? <div className="mt-4 grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div> : (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {disc.map((d) => (
                  <Link key={d.place_id} to={`/plan?q=${encodeURIComponent(`${d.city}, 2 days, include ${d.name}`)}`} className="group overflow-hidden rounded-2xl border border-edge bg-surface-card transition hover:shadow-elevated">
                    <PlaceImage id={d.place_id} cat={d.cat} alt={d.name} className="h-28 w-full transition group-hover:scale-[1.02]" />
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-content">{d.name}</span>
                        <span className="shrink-0 text-caption font-bold text-accent-on">{d.match}%</span>
                      </div>
                      <div className="text-caption text-content-muted">{d.city} · {d.why}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* activity */}
          <Card className="p-5">
            <Eyebrow className="mb-3">Recent activity</Eyebrow>
            {activity.length === 0 ? (
              <p className="text-body text-content-muted">Your planning, re-plans and what Tripzy learns will show up here.</p>
            ) : (
              <ol className="space-y-3">
                {activity.map((a, i) => {
                  const I = a.icon
                  const body = (
                    <div className="flex gap-3">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-secondary text-content-secondary"><I className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <div className="truncate text-body font-medium text-content">{a.text}</div>
                        <div className="text-caption text-content-muted">{a.sub}{a.demo && !a.sub.includes('Demo') ? ' · demo' : ''}</div>
                      </div>
                    </div>
                  )
                  return <li key={i}>{a.to ? <Link to={a.to} className="block rounded-xl hover:bg-surface-hover">{body}</Link> : body}</li>
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 text-caption text-content-muted">
          <Link to="/lab" className="inline-flex items-center gap-1 hover:text-content"><FlaskConical className="h-3.5 w-3.5" />Ripple Test Lab (simulated events)</Link>
          <span>·</span>
          <Link to="/status" className="hover:text-content">Data providers &amp; status</Link>
        </div>
      </div>
    </PageShell>
  )
}

function UpcomingCard({ trip, cap, capsule, demo }: { trip: Trip; cap?: CapsuleSummary; capsule: CapsuleX | null; demo: boolean }) {
  const photo = usePlacePhoto(cap ? `city:${cap.city_key}` : null)
  const until = trip.start_date ? daysUntil(trip.start_date) : null
  const live = trip.start_date && trip.end_date && trip.start_date <= today() && trip.end_date >= today()
  const status = live ? 'Travelling now' : capsule?.bookings.length ? 'Booked' : cap ? 'Planned with Tripzy' : 'Planning'
  const progress = [!!cap, !!capsule?.bookings.length, !!live].filter(Boolean).length
  return (
    <Card className="relative overflow-hidden">
      <div className="relative h-[190px] bg-surface-tertiary">
        {(trip.cover_image || photo) && <img src={trip.cover_image || photo!} alt="" className="h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1a3d]/85 via-[#0f1a3d]/20 to-transparent" />
        <div className="absolute left-5 top-4 flex gap-2">
          <span className="rounded-full bg-white/90 px-3 py-1 text-caption font-semibold text-[#0f1a3d]">Upcoming journey</span>
          {demo && <span className="tz-coral-btn rounded-full px-3 py-1 text-caption font-semibold">Demo trip</span>}
        </div>
        <div className="absolute bottom-4 left-5 right-5 text-white">
          <h2 className="text-[26px] font-bold leading-tight">{trip.title}</h2>
          <p className="text-white/80">{trip.start_date} → {trip.end_date}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <div><div className="text-caption text-content-muted">Departs</div><div className="text-subtitle font-bold text-content">{live ? 'Now' : until !== null ? `${until} day${until === 1 ? '' : 's'}` : '–'}</div></div>
        <div><div className="text-caption text-content-muted">Travellers</div><div className="flex items-center gap-1.5 text-subtitle font-bold text-content"><Users className="h-4 w-4 text-content-muted" />{capsule?.travellers.length ?? 1 + (trip.shared_count ?? 0)}</div></div>
        <div><div className="text-caption text-content-muted">Status</div><div className="text-body font-semibold text-content">{status}</div></div>
        <div className="flex items-center gap-2">{cap && cap.scores.length > 0 && <ScoreRing score={Math.min(...cap.scores)} size={44} label="lowest day" />}</div>
      </div>
      <div className="px-5 pb-5">
        <div className="mb-1 flex justify-between text-caption text-content-muted"><span>Trip readiness</span><span>{progress}/3 · planned · booked · on the road</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary"><div className="h-full rounded-full bg-accent" style={{ width: `${(progress / 3) * 100}%` }} /></div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to={cap ? `/trips/${trip.id}/intel` : `/trips/${trip.id}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-body font-semibold text-accent-text">View trip <ArrowRight className="h-4 w-4" /></Link>
          {cap && <Link to={`/trips/${trip.id}/live`} className="tz-coral-btn inline-flex h-10 items-center gap-2 rounded-xl px-4 text-body font-semibold"><Radio className="h-4 w-4" />Live Companion</Link>}
          <Link to={`/trips/${trip.id}`} className="inline-flex h-10 items-center rounded-xl border border-edge px-4 text-body font-semibold text-content hover:bg-surface-hover">Planner</Link>
        </div>
      </div>
    </Card>
  )
}

function TravelAlerts({ capsule, tripId }: { capsule: CapsuleX | null; tripId?: number }) {
  if (!capsule || !tripId) return null
  const alerts: { icon: React.ElementType; tone: 'warning' | 'accent' | 'danger'; text: string; sub: string }[] = []
  for (const d of capsule.days) {
    const w = d.weather
    if (w && w.rain_prob >= 50) alerts.push({ icon: CloudRain, tone: 'warning', text: `${w.rain_prob}% rain on Day ${d.index + 1} (${d.weekday})`, sub: `${w.source}. Indoor Plan B is ready for outdoor stops.` })
    if (d.verify.score < 75) alerts.push({ icon: Activity, tone: 'danger', text: `Day ${d.index + 1} feasibility ${d.verify.score}/100`, sub: d.verify.checks.find((c) => c.level !== 'ok')?.text ?? 'Review the day' })
  }
  for (const b of capsule.bookings) {
    alerts.push({ icon: Train, tone: 'accent', text: `${b.mode === 'train' ? 'Train' : b.mode} ${b.number} ${b.kind} · ${b.date} ${b.time}`, sub: capsule.demo ? 'Demo booking · live status is simulated' : 'Fixed anchor: Tripzy protects this connection' })
  }
  if (!alerts.length) return null
  return (
    <Card className="mt-5 p-5">
      <div className="flex items-center justify-between">
        <Eyebrow>Travel alerts · {capsule.city.name}</Eyebrow>
        <Link to={`/trips/${tripId}/intel`} className="text-caption font-semibold text-accent-on">Open trip →</Link>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {alerts.slice(0, 4).map((a, i) => {
          const I = a.icon
          return (
            <div key={i} className="flex gap-3 rounded-xl bg-surface-secondary p-3">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${a.tone === 'warning' ? 'bg-warning-soft text-warning' : a.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-subtle text-accent-on'}`}><I className="h-4 w-4" /></span>
              <div><div className="text-body font-semibold text-content">{a.text}</div><div className="text-caption text-content-muted">{a.sub}</div></div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function Quick({ to, icon: I, label }: { to: string; icon: React.ElementType; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-xl border border-edge p-3 text-body font-medium text-content transition hover:border-[var(--accent)] hover:bg-accent-subtle">
      <I className="h-4 w-4 shrink-0 text-accent-on" />{label}
    </Link>
  )
}

function Stat({ icon: I, value, label }: { icon: React.ElementType; value: React.ReactNode; label: string }) {
  return (
    <div>
      <I className="h-4 w-4 text-content-muted" />
      <div className="mt-1 text-[26px] font-bold tabular-nums text-content">{value}</div>
      <div className="text-caption text-content-muted">{label}</div>
    </div>
  )
}

export { Pill }
