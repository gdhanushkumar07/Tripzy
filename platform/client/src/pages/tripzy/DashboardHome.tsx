import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Activity, ArrowRight, ArrowUpRight, Brain, CalendarDays, CloudRain, Plus, Radio, ShieldCheck, Sparkles, Train, Users } from 'lucide-react'
import PageShell from '../../components/Layout/PageShell'
import { tripsApi } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import { engine, type CapsuleSummary, type DiscoverItem, type Profile, type Readiness } from '../../tripzy/engine'
import type { CapsuleX } from '../../tripzy/types'
import { PlaceImage, Skeleton, usePlacePhoto } from '../../tripzy/ui'
import { ALT_CITY_PHOTO, CITY_PHOTO, photoSrc } from '../../tripzy/photos'
import { useDocumentScroll, useReveal } from '../../tripzy/motion'

type Trip = { id: number; title: string; start_date: string | null; end_date: string | null; cover_image?: string | null; day_count?: number; place_count?: number; shared_count?: number; is_archived?: number }

const today = () => new Date().toISOString().slice(0, 10)
const daysUntil = (d: string) => Math.ceil((new Date(d + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime()) / 86400000)
const greeting = () => {
  const h = new Date().getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
const fmtDate = (d?: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '')
const fmtRange = (a?: string | null, b?: string | null) => (a ? `${fmtDate(a)} – ${fmtDate(b)}${b ? ` ${b.slice(0, 4)}` : ''}` : 'Dates not set')

/** Logged-in home: a personal travel journal with the next journey at its centre. */
export default function DashboardHome(): React.ReactElement {
  const nav = useNavigate()
  const root = useRef<HTMLDivElement>(null)
  const user = useAuthStore((s) => s.user) as { username?: string } | null
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [caps, setCaps] = useState<CapsuleSummary[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileFailed, setProfileFailed] = useState(false)
  const [disc, setDisc] = useState<DiscoverItem[] | null>(null)
  const [next, setNext] = useState<CapsuleX | null>(null)
  const [ready, setReady] = useState<Readiness | null>(null)
  const [err, setErr] = useState('')
  useDocumentScroll()

  useEffect(() => {
    let off = false
    tripsApi.list().then((r: { trips: Trip[] }) => !off && setTrips(r.trips ?? [])).catch(() => { if (!off) { setTrips([]); setErr('Could not load your trips.') } })
    engine.myCapsules().then((c) => !off && setCaps(c)).catch(() => undefined)
    engine.profile().then((p) => {
      if (off) return
      setProfile(p)
      let asked = false
      try { asked = sessionStorage.getItem('tripzy:onboard-asked') === '1' } catch { /* storage unavailable */ }
      if (!p.completed && !asked) {
        try { sessionStorage.setItem('tripzy:onboard-asked', '1') } catch { /* storage unavailable */ }
        nav('/onboarding')
      }
    }).catch(() => !off && setProfileFailed(true))
    engine.discover(undefined, 3).then((d) => !off && setDisc(d.items)).catch(() => !off && setDisc([]))
    return () => { off = true }
  }, [nav])

  const capByTrip = useMemo(() => new Map(caps.filter((c) => c.platform_trip_id).map((c) => [c.platform_trip_id!, c])), [caps])
  const isDemo = (t: Trip) => !!capByTrip.get(t.id)?.demo
  const live = (trips ?? []).filter((t) => !t.is_archived)
  const upcomingAll = live.filter((t) => t.end_date && t.end_date >= today()).sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))
  const upcoming = upcomingAll.find((t) => !isDemo(t)) ?? upcomingAll[0]
  const completed = live.filter((t) => t.end_date && t.end_date < today()).sort((a, b) => (b.end_date ?? '').localeCompare(a.end_date ?? ''))
  const others = [...upcomingAll.filter((t) => t.id !== upcoming?.id), ...completed, ...live.filter((t) => !t.end_date)]
  const nextCap = upcoming ? capByTrip.get(upcoming.id) : undefined

  useEffect(() => {
    let off = false
    if (nextCap) {
      engine.capsule(nextCap.id).then((c) => !off && setNext(c)).catch(() => !off && setNext(null))
      engine.readiness(nextCap.id).then((r) => !off && setReady(r)).catch(() => !off && setReady(null))
    } else { setNext(null); setReady(null) }
    return () => { off = true }
  }, [nextCap?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const moments = useMemo(() => {
    const rows: { icon: React.ElementType; text: string; sub: string; to?: string }[] = []
    for (const c of caps) {
      const to = c.platform_trip_id ? `/trips/${c.platform_trip_id}/intel` : undefined
      for (const l of c.learned) rows.push({ icon: Brain, text: l.text, sub: `Learned from ${l.from} · ${c.city}`, to })
      for (const r of c.ripple_log) rows.push({ icon: Activity, text: r.diff.headline, sub: `${c.city} · Day ${r.day + 1} · ${r.now}${c.demo ? ' · simulated' : ''}`, to })
      rows.push({ icon: Sparkles, text: `Planned ${c.city}, ${c.days} days`, sub: c.demo ? 'Demo trip' : `Feasibility ${c.scores.join(' · ')}`, to })
    }
    return rows.slice(0, 6)
  }, [caps])

  useReveal(root, [trips === null, caps.length, disc?.length])

  return (
    <PageShell background="var(--bg-primary)">
      <div ref={root} className="mx-auto max-w-[1280px] px-5 pb-24 pt-10 md:px-10">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div data-reveal className="tz-chapter">Every journey begins somewhere.</div>
            <h1 data-reveal className="tz-h1 mt-2 text-content">{greeting()}, {user?.username ?? 'traveller'}.</h1>
          </div>
          <Link to="/plan" className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-[15px] font-semibold text-accent-text transition hover:bg-accent-hover"><Plus className="h-4 w-4" />Plan a journey</Link>
        </header>
        {err && <div className="mt-6 rounded-2xl bg-danger-soft px-4 py-3 text-body text-danger">{err} <button type="button" className="underline" onClick={() => window.location.reload()}>Retry</button></div>}

        <section className="mt-10" aria-label="Your next journey">
          {trips === null ? <Skeleton className="h-[460px] rounded-[30px]" /> : upcoming
            ? <NextJourney trip={upcoming} cap={nextCap} capsule={next} ready={ready} demo={isDemo(upcoming)} />
            : <EmptyJourney />}
        </section>

        {others.length > 0 && (
          <section className="mt-20" aria-labelledby="journeys">
            <SectionHead id="journeys" kicker="My journeys" title="Where you've been, where you're going" />
            <ul data-reveal data-reveal-stagger className="mt-8 border-t border-edge">
              {others.map((t) => <JourneyRow key={t.id} trip={t} cap={capByTrip.get(t.id)} demo={isDemo(t)} />)}
            </ul>
          </section>
        )}

        <div className="mt-20 grid gap-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <section aria-labelledby="dna">
            <SectionHead id="dna" kicker="Your Travel DNA" title={profile?.completed ? 'How you like to travel' : 'Tell Tripzy how you travel'} />
            <DnaPortrait profile={profile} failed={profileFailed} />
          </section>
          <section aria-labelledby="discover">
            <SectionHead id="discover" kicker="Discover" title="Picked for you" action={<Link to="/plan" className="tz-link text-[14px] font-semibold text-accent-on">Plan around these</Link>} />
            {disc === null ? <div className="mt-8 grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-[22px]" />)}</div> : disc.length === 0 ? (
              <p className="mt-8 max-w-md text-[15px] text-content-muted">Recommendations are taking a break right now. <Link to="/plan" className="text-accent-on underline underline-offset-2">Plan a journey</Link> and Tripzy will pick places for you there.</p>
            ) : (
              <div data-reveal data-reveal-stagger className="mt-8 grid gap-4 sm:grid-cols-3">
                {disc.map((d) => (
                  <Link key={d.place_id} to={`/plan?q=${encodeURIComponent(`${d.city}, 2 days, include ${d.name}`)}`} className="group block">
                    <div className="overflow-hidden rounded-[22px]"><PlaceImage id={d.place_id} cat={d.cat} alt={d.name} className="aspect-[4/5] w-full transition duration-700 group-hover:scale-[1.04]" /></div>
                    <div className="mt-3 flex items-baseline justify-between gap-2"><span className="truncate font-serif text-[21px] text-content">{d.name}</span><span className="shrink-0 text-[12px] font-semibold text-accent-on">{d.match}% match</span></div>
                    <div className="text-[13px] text-content-muted">{d.city} · {d.why}</div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="mt-20" aria-labelledby="moments">
          <SectionHead id="moments" kicker="Recent moments" title="What changed, what Tripzy learned" />
          {moments.length === 0 ? (
            <p className="mt-6 max-w-md text-[15px] text-content-muted">Plans, re-plans and the things Tripzy learns about you will collect here as you travel.</p>
          ) : (
            <ol data-reveal data-reveal-stagger className="mt-8 grid gap-x-12 md:grid-cols-2">
              {moments.map((m, i) => {
                const I = m.icon
                const body = (
                  <div className="flex gap-4 border-b border-edge py-4">
                    <I className="mt-1 h-4 w-4 shrink-0 text-[var(--tz-sun)]" />
                    <div className="min-w-0"><div className="text-[15px] text-content">{m.text}</div><div className="mt-0.5 text-[13px] text-content-muted">{m.sub}</div></div>
                  </div>
                )
                return <li key={i}>{m.to ? <Link to={m.to} className="block transition hover:opacity-80">{body}</Link> : body}</li>
              })}
            </ol>
          )}
        </section>

        <footer className="mt-20 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-edge pt-6 text-[13px] text-content-muted">
          <Link to="/status" className="hover:text-content">Data providers &amp; status</Link>
          <Link to="/credits" className="hover:text-content">Photo credits</Link>
        </footer>
      </div>
    </PageShell>
  )
}

function SectionHead({ id, kicker, title, action }: { id: string; kicker: string; title: string; action?: React.ReactNode }) {
  return (
    <div data-reveal className="flex flex-wrap items-end justify-between gap-4">
      <div><div className="tz-kicker">{kicker}</div><h2 id={id} className="tz-h3 mt-2 text-content">{title}</h2></div>
      {action}
    </div>
  )
}

function useTripPhoto(cityKey?: string, cover?: string | null) {
  const wiki = usePlacePhoto(cityKey && !CITY_PHOTO[cityKey] ? `city:${cityKey}` : null)
  if (cover) return cover
  if (cityKey && CITY_PHOTO[cityKey]) return photoSrc(CITY_PHOTO[cityKey])
  return wiki
}

function NextJourney({ trip, cap, capsule, ready, demo }: { trip: Trip; cap?: CapsuleSummary; capsule: CapsuleX | null; ready: Readiness | null; demo: boolean }) {
  const photo = useTripPhoto(cap?.city_key, trip.cover_image)
  const until = trip.start_date ? daysUntil(trip.start_date) : null
  const onTrip = !!(trip.start_date && trip.end_date && trip.start_date <= today() && trip.end_date >= today())
  const nextAction = ready?.checklist.find((c) => !c.done)
  const alerts: { icon: React.ElementType; text: string }[] = []
  for (const d of capsule?.days ?? []) {
    if (d.weather && d.weather.rain_prob >= 50) alerts.push({ icon: CloudRain, text: `${d.weather.rain_prob}% rain on Day ${d.index + 1}. Indoor Plan B is ready.` })
    if (d.verify.score < 75) alerts.push({ icon: Activity, text: `Day ${d.index + 1} feasibility ${d.verify.score}/100. Worth a look.` })
  }
  const train = capsule?.bookings[0]
  return (
    <article className="overflow-hidden rounded-[30px] bg-[#18211F] text-white">
      <div className="grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="relative min-h-[340px] lg:min-h-[520px]">
          {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-[#18211F] via-[#18211F]/30 to-transparent lg:bg-gradient-to-r lg:from-transparent lg:via-transparent lg:to-[#18211F]/40" />
          <div className="absolute left-6 top-6 flex gap-2">
            <span className="rounded-full bg-white/15 px-3 py-1 text-[12px] font-medium backdrop-blur-md">{onTrip ? 'Travelling now' : 'Your next journey'}</span>
            {demo && <span className="rounded-full bg-[#D98955] px-3 py-1 text-[12px] font-semibold text-[#18211F]">Demo trip</span>}
          </div>
          <div className="absolute bottom-6 left-6 right-6">
            <h2 className="font-serif text-[44px] leading-[0.95] md:text-[64px]">{cap?.city ?? trip.title}</h2>
            <p className="mt-2 text-[15px] text-white/80">{fmtRange(trip.start_date, trip.end_date)}{cap && trip.title !== cap.city ? ` · ${trip.title}` : ''}</p>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-8 p-6 md:p-10">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">{onTrip ? 'Today' : 'Departs in'}</div>
              <div className="mt-1 font-serif text-[52px] leading-none">{onTrip ? 'Live' : until !== null ? <>{until}<span className="ms-1 text-[22px] text-white/60">day{until === 1 ? '' : 's'}</span></> : '–'}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">Ready</div>
              <div className="mt-1 font-serif text-[52px] leading-none">{ready ? `${ready.score}%` : cap ? '…' : '–'}</div>
              {ready && <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#D98955]" style={{ width: `${ready.score}%` }} /></div>}
            </div>
            <div className="flex items-center gap-2 text-[14px] text-white/75"><Users className="h-4 w-4" />{capsule?.travellers.length ?? 1 + (trip.shared_count ?? 0)} traveller{(capsule?.travellers.length ?? 1) > 1 ? 's' : ''}</div>
            {train && <div className="flex items-center gap-2 text-[14px] text-white/75"><Train className="h-4 w-4" />{train.mode === 'train' ? 'Train' : 'Flight'} {train.number} · {train.time}</div>}
          </div>

          <div>
            {nextAction && (
              <Link to={`/trips/${trip.id}/ready`} className="group block border-t border-white/10 pt-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D98955]">Next step</div>
                <div className="mt-1 flex items-center justify-between gap-3 text-[17px]">{nextAction.title}<ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" /></div>
              </Link>
            )}
            {alerts.slice(0, 2).map((a, i) => {
              const I = a.icon
              return <div key={i} className="mt-3 flex gap-2 text-[13px] text-white/70"><I className="mt-0.5 h-3.5 w-3.5 shrink-0" />{a.text}</div>
            })}
            <div className="mt-6 flex flex-wrap gap-2">
              <Link to={cap ? `/trips/${trip.id}/intel` : `/trips/${trip.id}`} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#F7F5EF] px-5 text-[14px] font-semibold text-[#18211F] transition hover:bg-white">Open journey <ArrowRight className="h-4 w-4" /></Link>
              {cap && <Link to={`/trips/${trip.id}/ready`} className="inline-flex h-11 items-center gap-2 rounded-full border border-white/25 px-5 text-[14px] font-semibold transition hover:bg-white/10"><ShieldCheck className="h-4 w-4" />Get ready</Link>}
              {cap && <Link to={`/trips/${trip.id}/live`} className="inline-flex h-11 items-center gap-2 rounded-full border border-white/25 px-5 text-[14px] font-semibold transition hover:bg-white/10"><Radio className="h-4 w-4" />Live</Link>}
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

function EmptyJourney() {
  return (
    <article className="relative overflow-hidden rounded-[30px] bg-[#18211F] text-white">
      <img src={photoSrc('jal-mahal')} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#18211F] via-[#18211F]/70 to-transparent" />
      <div className="relative max-w-xl p-8 md:p-14">
        <div className="tz-chapter !text-[#D98955]">No journey planned yet</div>
        <h2 className="mt-3 font-serif text-[44px] leading-[1] md:text-[60px]">Where to next?</h2>
        <p className="mt-4 text-[16px] leading-relaxed text-white/80">Describe a trip in one sentence. Tripzy builds a plan around who's going and how you like to travel, then checks that every day actually works.</p>
        <Link to="/plan" className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-[#F7F5EF] px-6 text-[15px] font-semibold text-[#18211F]">Plan your first journey <ArrowRight className="h-4 w-4" /></Link>
      </div>
    </article>
  )
}

function JourneyRow({ trip, cap, demo }: { trip: Trip; cap?: CapsuleSummary; demo: boolean }) {
  const photo = useTripPhoto(cap?.city_key, trip.cover_image) ?? (cap?.city_key && ALT_CITY_PHOTO[cap.city_key] ? photoSrc(ALT_CITY_PHOTO[cap.city_key], true) : null)
  const past = !!(trip.end_date && trip.end_date < today())
  return (
    <li>
      <Link to={cap ? `/trips/${trip.id}/intel` : `/trips/${trip.id}`} className="group grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-5 border-b border-edge py-5 md:grid-cols-[120px_minmax(0,1fr)_200px_auto]">
        <div className="aspect-[4/3] overflow-hidden rounded-xl bg-surface-tertiary">{photo && <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />}</div>
        <div className="min-w-0">
          <div className="truncate font-serif text-[24px] leading-tight text-content md:text-[28px]">{trip.title}</div>
          <div className="mt-1 text-[13px] text-content-muted md:hidden">{fmtRange(trip.start_date, trip.end_date)}</div>
        </div>
        <div className="hidden text-[14px] text-content-muted md:block"><CalendarDays className="me-1.5 inline h-3.5 w-3.5" />{fmtRange(trip.start_date, trip.end_date)}</div>
        <div className="flex items-center gap-3">
          <span className={`hidden rounded-full px-2.5 py-1 text-[12px] sm:inline ${past ? 'bg-surface-secondary text-content-muted' : 'bg-accent-subtle text-accent-on'}`}>{demo ? 'Demo' : past ? 'Completed' : trip.end_date ? 'Upcoming' : 'Draft'}</span>
          <ArrowUpRight className="h-5 w-5 text-content-faint transition group-hover:text-content" />
        </div>
      </Link>
    </li>
  )
}

const TRAITS: [keyof Profile['dna'], string, string][] = [
  ['pace', 'Unhurried', 'Packed'],
  ['stamina', 'Gentle', 'Tireless'],
  ['budget', 'Thrifty', 'Indulgent'],
  ['morning', 'Late starts', 'Sunrise'],
]

function DnaPortrait({ profile, failed }: { profile: Profile | null; failed?: boolean }) {
  if (!profile && !failed) return <Skeleton className="mt-8 h-64 rounded-[22px]" />
  if (!profile || !profile.completed) {
    return (
      <div className="mt-8 rounded-[22px] border border-dashed border-edge p-8">
        <p className="text-[15px] text-content-muted">Two minutes of questions and every plan starts from you: your pace, your interests, who you travel with.</p>
        <Link to="/onboarding" className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-accent-text">Shape my Travel DNA</Link>
      </div>
    )
  }
  const dna = profile.dna
  const interests = Object.entries(dna.interests ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6)
  return (
    <div data-reveal className="mt-8">
      <div className="space-y-5">
        {TRAITS.map(([k, lo, hi]) => {
          const v = Number(dna[k] ?? 0.5)
          return (
            <div key={k}>
              <div className="flex justify-between text-[12px] text-content-muted"><span>{lo}</span><span>{hi}</span></div>
              <div className="relative mt-2 h-px bg-[var(--border-primary)]">
                <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-4 ring-[var(--bg-primary)]" style={{ left: `${Math.round(v * 100)}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-8 flex flex-wrap gap-2">
        {interests.map(([k, v]) => (
          <span key={k} className="rounded-full border border-edge px-3 py-1.5 text-[13px] capitalize text-content-secondary" style={{ opacity: 0.45 + v * 0.55 }}>{k}</span>
        ))}
      </div>
      <Link to="/dna" className="tz-link mt-6 inline-block text-[14px] font-semibold text-accent-on">See how it's changed</Link>
    </div>
  )
}
