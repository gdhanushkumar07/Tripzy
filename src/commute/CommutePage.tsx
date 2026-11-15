import { setDoc } from 'firebase/firestore'
import { Car, Minus, Plus, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { api, type GeoPoint } from '../lib/api'
import { useAuth } from '../lib/auth'
import { createGroup, newId, routeDoc, setGroup, updateMember, write } from '../lib/db'
import { logEvent, useTaste } from '../lib/history'
import { ErrorBox, SaveStatus, Skeleton, useAction, useStatus } from '../lib/status'
import { MODES, MODE_ICON, MODE_LABEL, type Mode } from '../lib/types'
import { useDraft } from '../lib/useDraft'
import { GroupPanel, ModeToggle, useGroup } from '../lib/useGroup'
import { budgetError, optNum, transfersError, validTime } from '../lib/validate'
import { LocationInput } from '../ui/LocationInput'
import { fmtDur, fmtTime, type GroupPlan, type PlanResult, type TogetherPlan } from './engine'
import { LegList, MapView, RouteCard, routeLayers, storable, type LiveRoute } from './RouteView'

export type CommuteForm = {
  from: GeoPoint | null; to: GeoPoint | null; date: string; time: string; modes: Mode[]
  budget: string; maxTransfers: string; people: number; touched: boolean; groupCode: string | null
}
const today = () => new Date().toISOString().slice(0, 10)
const EMPTY: CommuteForm = { from: null, to: null, date: today(), time: '18:00', modes: [], budget: '', maxTransfers: '', people: 1, touched: false, groupCode: null }

const PRESETS: { name: string; from: GeoPoint; to: GeoPoint; time: string }[] = [
  { name: 'Kokapet → Warangal (evening peak)', from: { name: 'Kokapet', lat: 17.3949, lon: 78.3365, state: 'Telangana', city: 'Hyderabad' }, to: { name: 'Warangal', lat: 17.9689, lon: 79.5941, state: 'Telangana', city: 'Warangal' }, time: '18:00' },
  { name: 'Gachibowli → Charminar', from: { name: 'Gachibowli', lat: 17.4401, lon: 78.3489, state: 'Telangana', city: 'Hyderabad' }, to: { name: 'Charminar', lat: 17.3616, lon: 78.4747, state: 'Telangana', city: 'Hyderabad' }, time: '09:00' },
]

const ll = (p: GeoPoint) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`
const parseLL = (name: string | null, v: string | null): GeoPoint | null => {
  if (!name || !v) return null
  const [lat, lon] = v.split(',').map(Number)
  return Number.isFinite(lat) && Number.isFinite(lon) ? { name, lat, lon } : null
}

/** Encode a search in the URL so refresh, back/forward and saved-route links all work. */
export function commuteUrl(f: { from: GeoPoint; to: GeoPoint; time: string; date?: string; modes: Mode[]; budget?: string | number | null; maxTransfers?: string | number | null; people?: number }) {
  const p = new URLSearchParams({ f: f.from.name, fl: ll(f.from), t: f.to.name, tl: ll(f.to), tm: f.time, m: f.modes.join(',') })
  if (f.date) p.set('d', f.date)
  if (f.people && f.people > 1) p.set('p', String(f.people))
  if (f.budget !== '' && f.budget != null) p.set('b', String(f.budget))
  if (f.maxTransfers !== '' && f.maxTransfers != null) p.set('x', String(f.maxTransfers))
  return `/commute?${p}`
}

type LivePlan = Omit<PlanResult, 'routes'> & { routes: LiveRoute[]; sources?: string[] }
type LiveGroup = Omit<GroupPlan, 'shared' | 'members' | 'together'> & {
  shared: LiveRoute | null; members: { id: string; name: string; to: string; route: LiveRoute | null; perPerson: number }[]
  together?: Omit<TogetherPlan, 'stops'> & { stops: { id: string; name: string; to: string; route: LiveRoute; perPerson: number; arrive: number }[] }
  sources?: string[]
}
type GroupResult = LiveGroup & { at: number; fromName: string; time: string }

export default function CommutePage() {
  const { user, profile } = useAuth()
  const { toast } = useStatus()
  const taste = useTaste(user?.uid)
  const [params, setParams] = useSearchParams()
  const draft = useDraft<CommuteForm>('commute', EMPTY)
  const f = { ...EMPTY, ...draft.value, from: typeof draft.value.from === 'object' ? draft.value.from : null, to: typeof draft.value.to === 'object' ? draft.value.to : null }
  const set = (patch: Partial<CommuteForm>) => draft.update((p) => ({ ...p, ...patch, touched: true }))
  const groupCode = params.get('group')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Preselect preferred modes (saved preferences, else what history says you use) until changed.
  const prefModes = (profile.prefs.modes.length ? profile.prefs.modes : taste?.modes ?? []).join(',')
  useEffect(() => {
    if (!f.touched && draft.restored && f.modes.join(',') !== prefModes && prefModes) draft.update((p) => ({ ...p, modes: prefModes.split(',') as Mode[] }))
  }, [f.touched, f.modes, prefModes, draft])

  // The URL is the source of truth for the search shown.
  const q = useMemo(() => {
    const from = parseLL(params.get('f'), params.get('fl')), to = parseLL(params.get('t'), params.get('tl')), t = params.get('tm')
    if (!from || !to || !t || !validTime(t)) return null
    const modes = (params.get('m') ?? '').split(',').filter((m): m is Mode => (MODES as readonly string[]).includes(m))
    return { from, to, time: t, date: params.get('d') ?? today(), modes, people: Number(params.get('p') ?? 1) || 1, budget: optNum(params.get('b') ?? ''), maxTransfers: optNum(params.get('x') ?? '') }
  }, [params])
  useEffect(() => {
    if (!q) return
    draft.update((p) => ({ ...p, from: q.from, to: q.to, time: q.time, date: q.date, modes: q.modes, people: q.people, budget: q.budget?.toString() ?? '', maxTransfers: q.maxTransfers?.toString() ?? '', touched: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  useEffect(() => {
    if (groupCode && f.groupCode !== groupCode) draft.update((p) => ({ ...p, groupCode }))
  }, [groupCode, f.groupCode, draft])

  // ------------------------------------------------------------ live search
  const [result, setResult] = useState<LivePlan | null>(null)
  const search = useAction(async (query: NonNullable<typeof q>) => {
    setResult(null)
    const r = await api.post<LivePlan>('/api/commute/plan', query, `commute:${JSON.stringify(query)}`)
    setResult(r)
    if (user) logEvent(user.uid, { type: 'commute_search', at: Date.now(), modes: query.modes, people: query.people })
  })
  const lastQ = useRef('')
  useEffect(() => {
    if (!q || groupCode) return
    const k = JSON.stringify(q)
    if (k === lastQ.current) return
    lastQ.current = k
    void search.run(q)
  }, [q, groupCode, search])
  const open = params.get('open')

  const validate = (needTo: boolean) => {
    const e: Record<string, string> = {}
    if (!f.from) e.from = 'Choose where you start (pick from the list).'
    if (needTo && !f.to) e.to = 'Choose where you are going (pick from the list).'
    if (needTo && f.from && f.to && ll(f.from) === ll(f.to)) e.to = 'Destination must be different from the start.'
    if (!validTime(f.time)) e.time = 'Enter a time like 18:00.'
    const b = budgetError(optNum(f.budget)); if (b) e.budget = b
    const x = transfersError(optNum(f.maxTransfers)); if (x) e.maxTransfers = x
    if (!f.modes.length) e.modes = 'Pick at least one way of travelling.'
    setErrors(e)
    return !Object.keys(e).length
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!validate(true)) return
    setParams(new URLSearchParams(commuteUrl({ ...f, from: f.from!, to: f.to! }).split('?')[1]))
  }

  const save = useAction(async (routeId: string) => {
    if (!user || !q) return
    const r = result?.routes.find((x) => x.id === routeId)
    const id = newId()
    const res = await write(() => setDoc(routeDoc(user.uid, id), {
      from: q.from.name.slice(0, 40), to: q.to.name.slice(0, 40), fromPt: q.from, toPt: q.to, time: q.time, modes: q.modes,
      budget: q.budget, maxTransfers: q.maxTransfers, people: q.people,
      title: `${q.from.name} → ${q.to.name}`.slice(0, 80), summary: r ? `${r.labels.join(' · ')} · ${fmtDur(r.totalMin)} · ₹${r.fare}` : '',
      createdAt: Date.now(),
    }), `save-route:${ll(q.from)}:${ll(q.to)}:${q.time}`)
    logEvent(user.uid, { type: 'route_saved', at: Date.now(), modes: r ? [...new Set(r.legs.map((l) => l.mode))] : q.modes, from: q.from.name, to: q.to.name })
    toast(res === 'local' ? 'Route saved on this device — will sync when online' : 'Route saved. Reopen it from your dashboard.', 'success')
  })

  // ------------------------------------------------------------ group mode
  const { group, error: groupError } = useGroup<GroupResult>(groupCode, (r) =>
    toast(r.together?.recommended ? `Group plan ready — one ${r.together.mode === 'suv' ? 'SUV' : 'cab'} for everyone` : `Group plan ready — split at ${r.splitName}`, 'success'),
  )
  const isOwner = !!group && group.ownerUid === user?.uid
  const me = user ? (group?.members[user.uid] as { dest?: GeoPoint } | undefined) : undefined
  const settings = group?.settings as { from?: GeoPoint; time?: string; date?: string; modes?: Mode[] } | undefined

  const startGroup = useAction(async () => {
    if (!user) return
    if (!validate(false)) throw Object.assign(new Error('form'), { code: 'invalid-argument' })
    const code = await createGroup('commute', user.uid, profile.name, { from: f.from, time: f.time, date: f.date, modes: f.modes })
    setParams({ group: code })
  })

  const setDestination = async (to: GeoPoint | null) => {
    if (!user || !groupCode) return
    set({ to })
    try {
      await updateMember(groupCode, user.uid, { dest: to ?? undefined, destination: to?.name.slice(0, 40), ready: !!to } as never)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const planForGroup = useAction(async () => {
    if (!group || !groupCode) return
    if (!validate(false)) return
    const members = group.memberUids
      .map((uid) => ({ id: uid, name: group.members[uid]?.name ?? 'Member', point: (group.members[uid] as { dest?: GeoPoint })?.dest }))
      .filter((m) => m.point)
    if (!members.length) throw Object.assign(new Error('none'), { code: 'failed-precondition' })
    const r = await api.post<LiveGroup>('/api/commute/group', { from: f.from, date: f.date, time: f.time, modes: f.modes, members }, `group:${groupCode}:${Date.now()}`)
    const safe: LiveGroup = {
      ...r, shared: r.shared ? storable(r.shared) : null,
      members: r.members.map((m) => ({ ...m, route: m.route ? storable(m.route) : null })),
      together: r.together ? { ...r.together, stops: r.together.stops.map((s) => ({ ...s, route: storable(s.route) })) } : undefined,
    }
    await setGroup(groupCode, { settings: { from: f.from, time: f.time, date: f.date, modes: f.modes }, result: { ...safe, at: Date.now(), fromName: f.from!.name, time: f.time } })
  })

  const mode: 'solo' | 'group' = groupCode ? 'group' : 'solo'
  const groupLocked = mode === 'group' && !isOwner

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 px-5 pb-24 pt-10 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="tz-chapter">The nearest bus stand is not always the fastest way out.</div>
          <h1 className="tz-h1 mt-2 text-content">Daily Traveller</h1>
          <p className="mt-3 max-w-2xl text-[16px] text-content-muted">Door-to-door routes anywhere in India, mixing metro, buses, trains, autos and cabs — live road times and real timetables.</p>
        </div>
        <div className="flex items-center gap-3">
          <SaveStatus status={draft.status} onRetry={() => void draft.retry()} />
          <ModeToggle
            value={mode}
            disabled={startGroup.busy}
            onChange={(v) => {
              if (v === 'solo') setParams(q ? new URLSearchParams(commuteUrl(q).split('?')[1]) : {})
              else if (f.groupCode && f.groupCode !== groupCode) setParams({ group: f.groupCode })
              else void startGroup.run()
            }}
          />
        </div>
      </div>
      {startGroup.error && <ErrorBox message={startGroup.error.includes('valid') ? 'Choose your start, time and modes first, then switch to Group.' : startGroup.error} onRetry={() => void startGroup.retry()} />}

      <form onSubmit={submit} className="card space-y-5" noValidate>
        {!q && !groupCode && (
          <div className="flex flex-wrap gap-2 text-body">
            <span className="text-content-muted">Try:</span>
            {PRESETS.map((p) => (
              <button type="button" key={p.name} className="btn-link" onClick={() => setParams(new URLSearchParams(commuteUrl({ ...p, date: f.date, modes: f.modes.length ? f.modes : profile.prefs.modes, people: f.people }).split('?')[1]))}>
                {p.name}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <LocationInput label="From" value={groupLocked ? settings?.from ?? null : f.from} onChange={(p) => set({ from: p })} disabled={groupLocked} />
            {errors.from && <p className="field-error">{errors.from}</p>}
          </div>
          <div>
            <LocationInput label={mode === 'group' ? 'Your destination' : 'To'} value={mode === 'group' ? me?.dest ?? null : f.to}
              onChange={(p) => (mode === 'group' ? void setDestination(p) : set({ to: p }))} near={f.from} />
            {errors.to && <p className="field-error">{errors.to}</p>}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="date">Date</label>
            <input id="date" type="date" min={today()} className="tz-input" value={groupLocked ? settings?.date ?? '' : f.date} disabled={groupLocked} onChange={(e) => set({ date: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="time">Departure time</label>
            <input id="time" type="time" className="tz-input" value={groupLocked ? settings?.time ?? '' : f.time} disabled={groupLocked} onChange={(e) => set({ time: e.target.value })} />
            {errors.time && <p className="field-error">{errors.time}</p>}
          </div>
          {mode === 'solo' && (
            <div>
              <span className="label">Travelling together</span>
              <div className="flex h-11 items-center gap-2">
                <button type="button" className="btn-secondary btn-sm !h-11 !w-11 !p-0" aria-label="Fewer people" onClick={() => set({ people: Math.max(1, f.people - 1) })}><Minus className="h-4 w-4" /></button>
                <span className="min-w-[5rem] text-center text-body font-semibold" aria-live="polite"><Users className="me-1 inline h-4 w-4" />{f.people} {f.people === 1 ? 'person' : 'people'}</span>
                <button type="button" className="btn-secondary btn-sm !h-11 !w-11 !p-0" aria-label="More people" onClick={() => set({ people: Math.min(8, f.people + 1) })}><Plus className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </div>
        {mode === 'solo' && f.people >= 3 && !f.modes.includes('cab') && !f.modes.includes('suv') && (
          <p className="rounded-2xl bg-accent-subtle px-4 py-3 text-body text-content-secondary"><Car className="me-1 inline h-4 w-4" />With {f.people} people a shared cab is often cheaper per person and more comfortable. <button type="button" className="btn-link" onClick={() => set({ modes: [...f.modes, f.people > 4 ? 'suv' : 'cab'] })}>Add {f.people > 4 ? 'SUV cab' : 'cab'}</button></p>
        )}

        {!groupLocked && (
          <fieldset>
            <legend className="label">Modes you're comfortable with</legend>
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => {
                const on = f.modes.includes(m)
                return (
                  <button type="button" key={m} aria-pressed={on} className={`chip ${on ? 'chip-on' : 'chip-off'}`} onClick={() => set({ modes: on ? f.modes.filter((x) => x !== m) : [...f.modes, m] })}>
                    <span aria-hidden>{MODE_ICON[m]}</span>{MODE_LABEL[m]}
                  </button>
                )
              })}
            </div>
            {taste && taste.modes.length > 0 && <p className="mt-2 text-caption text-content-faint">From your history you usually travel by {taste.modes.slice(0, 3).map((m) => MODE_LABEL[m].toLowerCase()).join(', ')}.</p>}
            {errors.modes && <p className="field-error">{errors.modes}</p>}
          </fieldset>
        )}

        {mode === 'solo' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="budget">Budget per person (₹, optional)</label>
              <input id="budget" inputMode="numeric" className="tz-input" value={f.budget} onChange={(e) => set({ budget: e.target.value.replace(/[^\d]/g, '') })} placeholder="No limit" />
              {errors.budget && <p className="field-error">{errors.budget}</p>}
            </div>
            <div>
              <label className="label" htmlFor="maxTransfers">Max transfers (optional)</label>
              <input id="maxTransfers" inputMode="numeric" className="tz-input" value={f.maxTransfers} onChange={(e) => set({ maxTransfers: e.target.value.replace(/[^\d]/g, '') })} placeholder="Any" />
              {errors.maxTransfers && <p className="field-error">{errors.maxTransfers}</p>}
            </div>
            <div className="flex items-end">
              <button className="btn h-12 w-full" disabled={search.busy}>{search.busy ? 'Finding routes…' : 'Find routes'}</button>
            </div>
          </div>
        )}
      </form>

      {mode === 'solo' && search.busy && (
        <div className="space-y-3" aria-live="polite">
          <p className="text-body text-content-muted">Checking live road times, metro and bus timetables, trains and intercity buses…</p>
          <div className="grid gap-3 md:grid-cols-3"><Skeleton lines={1} /><Skeleton lines={1} /><Skeleton lines={1} /></div>
        </div>
      )}
      {mode === 'solo' && search.error && !search.busy && <ErrorBox message={search.error} onRetry={() => void search.retry()} />}
      {mode === 'solo' && result && !search.busy && (
        <SoloResults result={result} open={open}
          setOpen={(id) => { const p = new URLSearchParams(params); if (id) p.set('open', id); else p.delete('open'); setParams(p, { replace: true }) }}
          onSave={(id) => void save.run(id)} saving={save.busy}
          onAddMode={(m) => { const modes = [...f.modes, m]; set({ modes }); if (q) setParams(new URLSearchParams(commuteUrl({ ...q, modes }).split('?')[1])) }}
        />
      )}
      {save.error && <ErrorBox message={save.error} onRetry={() => void save.retry()} />}

      {mode === 'group' && groupCode && (
        <>
          {groupError ? (
            <ErrorBox message={groupError}>
              <button className="btn-secondary" onClick={() => { draft.update((p) => ({ ...p, groupCode: null })); setParams({}) }}>Back to solo</button>
            </ErrorBox>
          ) : (
            <GroupPanel code={groupCode} group={group} type="commute">
              <p className="text-body text-content-muted">
                Everyone leaves together from <strong>{settings?.from?.name ?? f.from?.name ?? '…'}</strong> at <strong>{settings?.time ?? f.time}</strong>. Each member picks their own destination above. Tripzy compares splitting up on the way with one cab for everyone.
              </p>
              {isOwner ? (
                <button className="btn" onClick={() => void planForGroup.run()} disabled={planForGroup.busy}>
                  {planForGroup.busy ? 'Planning with live data…' : group?.result ? 'Re-plan for the group' : 'Plan for the group'}
                </button>
              ) : (
                <p className="text-body text-content-muted">The organiser will plan the trip. You'll get a notification here when it's ready.</p>
              )}
              {planForGroup.error && <ErrorBox message={planForGroup.error.includes('valid') ? 'Ask members to set their destination first.' : planForGroup.error} onRetry={() => void planForGroup.retry()} />}
            </GroupPanel>
          )}
          {planForGroup.busy && <Skeleton lines={2} />}
          {group?.result && <GroupResultView r={group.result} myUid={user?.uid ?? ''} />}
        </>
      )}
    </div>
  )
}

function Sources({ list }: { list?: string[] }) {
  if (!list?.length) return null
  return <p className="text-caption text-content-faint">Data: {list.join(' · ')}. Fares marked “est.” are estimates from published tariffs — book through the linked apps for exact prices.</p>
}

function SoloResults({ result, open, setOpen, onSave, saving, onAddMode }: {
  result: LivePlan; open: string | null; setOpen: (id: string | null) => void
  onSave: (id: string) => void; saving: boolean; onAddMode: (m: Mode) => void
}) {
  if (!result.routes.length) {
    return (
      <section className="card" role="alert">
        <h2 className="font-serif text-[28px] leading-tight text-content">No route found</h2>
        <p className="mt-1 text-body text-content-secondary">{result.message}</p>
        {!!result.suggestions.length && (
          <div className="mt-3 flex flex-wrap gap-2">
            {result.suggestions.map((s) => <button key={s.mode} className="btn-secondary" onClick={() => onAddMode(s.mode)}>{MODE_ICON[s.mode]} {s.text}</button>)}
          </div>
        )}
      </section>
    )
  }
  return (
    <section aria-label="Routes" className="space-y-3">
      {result.baseline && (
        <p className="rounded-2xl bg-accent-subtle p-4 text-body text-content-secondary">
          The usual plan — go to the nearest hub, <strong>{result.baseline.hubName}</strong>, and travel on from there — takes <strong>{fmtDur(result.baseline.totalMin)}</strong>. The nearest hub is not always the fastest way.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {result.routes.map((r) => <RouteCard key={r.id} route={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onSave={() => onSave(r.id)} saving={saving} />)}
      </div>
      <Sources list={result.sources} />
    </section>
  )
}

function GroupResultView({ r, myUid }: { r: GroupResult; myUid: string }) {
  const t = r.together
  return (
    <section className="space-y-5" aria-label="Group plan">
      {t && (
        <article className={`card ${t.recommended ? 'ring-2 ring-[var(--accent)]' : ''}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${t.recommended ? 'bg-accent text-accent-text' : 'bg-surface-secondary text-content-muted'}`}>{t.recommended ? 'Recommended for this group' : 'Alternative'}</span>
            <span className="text-caption text-content-muted">{t.why}</span>
          </div>
          <h2 className="mt-2 font-serif text-[30px] leading-tight text-content">One {t.mode === 'suv' ? 'SUV' : 'cab'} for everyone · ₹{t.totalPerPerson} each on average</h2>
          <p className="text-body text-content-muted">Door to door, dropping each person nearest-first. Each stretch is split between the people still on board.</p>
          <ol className="mt-3 space-y-1 text-body">
            {t.stops.map((s, i) => <li key={s.id}><strong>{i + 1}. {s.name}</strong> → {s.to} · arrive {fmtTime(s.arrive)} · ₹{s.perPerson}</li>)}
          </ol>
          <div className="mt-4"><MapView layers={t.stops.flatMap((s) => routeLayers(s.route.legs, '#7c3aed'))} height={260} /></div>
        </article>
      )}
      <article className={`card space-y-4 ${t && !t.recommended ? 'ring-2 ring-[var(--accent)]' : ''}`}>
        <div>
          <div className="tz-kicker">Together, then apart</div>
          <h2 className="font-serif text-[30px] leading-tight text-content">Split plan · ₹{r.totalPerPerson} each on average</h2>
          <p className="text-body text-content-muted">Leave {r.fromName} at {r.time}. Shared part ₹{r.sharedPerPerson} per person (auto and cab fares split across the group).</p>
        </div>
        {r.shared ? (
          <div><h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-content-muted">Together</h3><LegList legs={r.shared.legs} who="Group" /></div>
        ) : <p className="text-body">Everyone sets off separately from the start.</p>}
        <div className="flex items-center gap-2" role="note">
          <span className="h-px flex-1 bg-accent" />
          <span className="rounded-full bg-accent px-3 py-1 text-body font-bold text-accent-text">✂ Split at {r.splitName}{r.shared ? ` · ${fmtTime(r.shared.arrive)}` : ''}</span>
          <span className="h-px flex-1 bg-accent" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {r.members.map((m) => (
            <div key={m.id} className={`rounded-2xl border p-3 ${m.id === myUid ? 'border-[var(--accent)] bg-accent-subtle' : 'border-edge'}`}>
              <p className="mb-2 font-semibold">{m.name}{m.id === myUid ? ' (you)' : ''} → {m.to}
                <span className="ml-2 text-body font-normal text-content-muted">₹{m.perPerson} total{m.route ? ` · arrive ${fmtTime(m.route.arrive)}` : ''}</span></p>
              {m.route ? <LegList legs={m.route.legs} who={m.name} /> : <p className="text-body text-content-muted">Arrives at the split point — no onward travel.</p>}
            </div>
          ))}
        </div>
        <MapView layers={[...(r.shared ? routeLayers(r.shared.legs, '#315c4c') : []), ...r.members.flatMap((m) => (m.route ? routeLayers(m.route.legs) : []))]} />
        <Sources list={r.sources} />
      </article>
    </section>
  )
}
