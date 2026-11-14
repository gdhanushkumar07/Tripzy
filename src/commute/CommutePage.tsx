import { setDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import graphData from '../data/hyderabad-graph.json'
import { useAuth } from '../lib/auth'
import { createGroup, newId, routeDoc, setGroup, updateMember, write } from '../lib/db'
import { SaveStatus, useAction, useStatus, ErrorBox } from '../lib/status'
import { MODES, MODE_ICON, MODE_LABEL, type Mode } from '../lib/types'
import { useDraft } from '../lib/useDraft'
import { GroupPanel, ModeToggle, useGroup } from '../lib/useGroup'
import { budgetError, optNum, transfersError, validTime } from '../lib/validate'
import { buildGraph, fmtDur, fmtTime, plan, planGroup, toMin, type GraphData, type GroupPlan } from './engine'
import { LegList, MapView, RouteCard } from './RouteView'

export const graph = buildGraph(graphData as unknown as GraphData)
const NODES = graphData.nodes
const PRESETS = (graphData as unknown as { presets: { name: string; from: string; to: string; time: string }[] }).presets
const nodeName = (id: string) => graph.nodes.get(id)?.name ?? id

export type CommuteForm = {
  from: string; to: string; time: string; modes: Mode[]; budget: string; maxTransfers: string
  touched: boolean; groupCode: string | null
}
const EMPTY: CommuteForm = { from: '', to: '', time: '18:00', modes: [], budget: '', maxTransfers: '', touched: false, groupCode: null }

/** Encode a search in the URL so refresh, back/forward and saved-route links all work. */
export function commuteUrl(f: { from: string; to: string; time: string; modes: Mode[]; budget?: string | number | null; maxTransfers?: string | number | null }) {
  const p = new URLSearchParams({ from: f.from, to: f.to, t: f.time, m: f.modes.join(',') })
  if (f.budget !== '' && f.budget != null) p.set('b', String(f.budget))
  if (f.maxTransfers !== '' && f.maxTransfers != null) p.set('x', String(f.maxTransfers))
  return `/commute?${p}`
}

type GroupResult = GroupPlan & { at: number; from: string; time: string }

export default function CommutePage() {
  const { user, profile } = useAuth()
  const { toast } = useStatus()
  const [params, setParams] = useSearchParams()
  const draft = useDraft<CommuteForm>('commute', EMPTY)
  const f = draft.value
  const set = (patch: Partial<CommuteForm>) => draft.update((p) => ({ ...p, ...patch, touched: true }))
  const groupCode = params.get('group')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Preselect the user's preferred modes until they change anything.
  const prefModes = profile.prefs.modes.join(',')
  useEffect(() => {
    if (!f.touched && draft.restored && f.modes.join(',') !== prefModes) {
      draft.update((p) => ({ ...p, modes: prefModes ? (prefModes.split(',') as Mode[]) : [] }))
    }
  }, [f.touched, f.modes, prefModes, draft])

  // The URL is the source of truth for the search shown; copy it into the form when it changes.
  const q = useMemo(() => {
    const from = params.get('from'), to = params.get('to'), t = params.get('t')
    if (!from || !to || !t || !graph.nodes.has(from) || !graph.nodes.has(to) || !validTime(t)) return null
    const modes = (params.get('m') ?? '').split(',').filter((m): m is Mode => (MODES as readonly string[]).includes(m))
    return { from, to, time: t, modes, budget: optNum(params.get('b') ?? ''), maxTransfers: optNum(params.get('x') ?? '') }
  }, [params])
  useEffect(() => {
    if (!q) return
    draft.update((p) =>
      p.from === q.from && p.to === q.to && p.time === q.time && p.modes.join() === q.modes.join() ? p
        : { ...p, from: q.from, to: q.to, time: q.time, modes: q.modes, budget: q.budget?.toString() ?? '', maxTransfers: q.maxTransfers?.toString() ?? '', touched: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  // Keep the group code in the draft so "Continue where you left off" can bring you back.
  useEffect(() => {
    if (groupCode && f.groupCode !== groupCode) draft.update((p) => ({ ...p, groupCode }))
  }, [groupCode, f.groupCode, draft])

  const result = useMemo(
    () => (q ? plan(graph, { from: q.from, to: q.to, depart: toMin(q.time), modes: q.modes, budget: q.budget, maxTransfers: q.maxTransfers }) : null),
    [q],
  )
  const open = params.get('open')

  const validate = (needTo: boolean) => {
    const e: Record<string, string> = {}
    if (!f.from) e.from = 'Choose where you start.'
    if (needTo && !f.to) e.to = 'Choose where you are going.'
    if (needTo && f.from && f.from === f.to) e.to = 'Destination must be different from the start.'
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
    setParams(new URLSearchParams(commuteUrl(f).split('?')[1]))
  }

  const save = useAction(async (routeId: string) => {
    if (!user || !q) return
    const r = result?.routes.find((x) => x.id === routeId)
    const id = newId()
    const res = await write(() => setDoc(routeDoc(user.uid, id), {
      from: q.from, to: q.to, time: q.time, modes: q.modes, budget: q.budget, maxTransfers: q.maxTransfers,
      title: `${nodeName(q.from)} → ${nodeName(q.to)}`, summary: r ? `${r.labels.join(' · ')} · ${fmtDur(r.totalMin)} · ₹${r.fare}` : '',
      createdAt: Date.now(),
    }), `save-route:${q.from}:${q.to}:${q.time}`)
    toast(res === 'local' ? 'Route saved on this device — will sync when online' : 'Route saved. Reopen it from your dashboard.', 'success')
  })

  // ------------------------------------------------------------ group mode
  const { group, error: groupError } = useGroup<GroupResult>(groupCode, (r) =>
    toast(`Group plan ready — split at ${r.splitName}`, 'success'),
  )
  const isOwner = !!group && group.ownerUid === user?.uid
  const me = user && group?.members[user.uid]

  const startGroup = useAction(async () => {
    if (!user) return
    if (!validate(false)) throw Object.assign(new Error('form'), { code: 'invalid-argument' })
    const code = await createGroup('commute', user.uid, profile.name, { from: f.from, time: f.time, modes: f.modes })
    setParams({ group: code })
  })

  const setDestination = async (to: string) => {
    if (!user || !groupCode) return
    set({ to })
    try {
      await updateMember(groupCode, user.uid, { destination: to, ready: !!to })
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const planForGroup = useAction(async () => {
    if (!group || !groupCode) return
    if (!validate(false)) return
    const members = group.memberUids
      .map((uid) => ({ id: uid, name: group.members[uid]?.name ?? 'Member', to: group.members[uid]?.destination ?? '' }))
      .filter((m) => m.to)
    if (!members.length) throw Object.assign(new Error('none'), { code: 'failed-precondition' })
    const p = planGroup(graph, { from: f.from, depart: toMin(f.time), modes: f.modes, members })
    if (!p) {
      toast('No shared plan works with these modes. Add more modes and try again.', 'error')
      return
    }
    await setGroup(groupCode, { settings: { from: f.from, time: f.time, modes: f.modes }, result: { ...p, at: Date.now(), from: f.from, time: f.time } })
  })

  const mode: 'solo' | 'group' = groupCode ? 'group' : 'solo'
  const settings = group?.settings as { from?: string; time?: string; modes?: Mode[] } | undefined
  const groupLocked = mode === 'group' && !isOwner // members share the organiser's origin and time

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 px-5 pb-24 pt-10 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="tz-chapter">The nearest bus stand is not always the fastest way out.</div>
          <h1 className="tz-h1 mt-2 text-content">Daily Traveller</h1>
          <p className="mt-3 max-w-2xl text-[16px] text-content-muted">Door-to-door routes that mix the modes you're comfortable with. <span className="sample">Sample data — estimates</span></p>
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
      {startGroup.error && <ErrorBox message={startGroup.error} onRetry={() => void startGroup.retry()} />}

      <form onSubmit={submit} className="card space-y-4" noValidate>
        {!result && !groupCode && (
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="text-content-muted">Try:</span>
            {PRESETS.map((p) => (
              <button type="button" key={p.name} className="btn-link" onClick={() => setParams(new URLSearchParams(commuteUrl({ ...p, modes: f.modes.length ? f.modes : profile.prefs.modes }).split('?')[1]))}>
                {p.name}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="from">From</label>
            <select id="from" className="input" value={groupLocked ? settings?.from ?? '' : f.from} disabled={groupLocked} onChange={(e) => set({ from: e.target.value })}>
              <option value="">Choose start…</option>
              {NODES.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            {errors.from && <p className="field-error">{errors.from}</p>}
          </div>
          <div>
            <label className="label" htmlFor="to">{mode === 'group' ? 'Your destination' : 'To'}</label>
            <select
              id="to" className="input"
              value={mode === 'group' ? (me?.destination ?? '') : f.to}
              onChange={(e) => (mode === 'group' ? void setDestination(e.target.value) : set({ to: e.target.value }))}
            >
              <option value="">Choose destination…</option>
              {NODES.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            {errors.to && <p className="field-error">{errors.to}</p>}
          </div>
          <div>
            <label className="label" htmlFor="time">Departure time</label>
            <input id="time" type="time" className="input" value={groupLocked ? settings?.time ?? '' : f.time} disabled={groupLocked} onChange={(e) => set({ time: e.target.value })} />
            {errors.time && <p className="field-error">{errors.time}</p>}
          </div>
        </div>

        {!groupLocked && (
          <fieldset>
            <legend className="label">Modes you're comfortable with</legend>
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => {
                const on = f.modes.includes(m)
                return (
                  <button
                    type="button" key={m} aria-pressed={on}
                    className={`chip ${on ? 'chip-on' : 'chip-off'}`}
                    onClick={() => set({ modes: on ? f.modes.filter((x) => x !== m) : [...f.modes, m] })}
                  >
                    <span aria-hidden>{MODE_ICON[m]}</span>{MODE_LABEL[m]}
                  </button>
                )
              })}
            </div>
            {errors.modes && <p className="field-error">{errors.modes}</p>}
          </fieldset>
        )}

        {mode === 'solo' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="budget">Budget (₹, optional)</label>
              <input id="budget" inputMode="numeric" className="input" value={f.budget} onChange={(e) => set({ budget: e.target.value.replace(/[^\d]/g, '') })} placeholder="No limit" />
              {errors.budget && <p className="field-error">{errors.budget}</p>}
            </div>
            <div>
              <label className="label" htmlFor="maxTransfers">Max transfers (optional)</label>
              <input id="maxTransfers" inputMode="numeric" className="input" value={f.maxTransfers} onChange={(e) => set({ maxTransfers: e.target.value.replace(/[^\d]/g, '') })} placeholder="Any" />
              {errors.maxTransfers && <p className="field-error">{errors.maxTransfers}</p>}
            </div>
            <div className="flex items-end">
              <button className="btn w-full">Find routes</button>
            </div>
          </div>
        )}
      </form>

      {mode === 'solo' && result && <SoloResults result={result} open={open} setOpen={(id) => {
        const p = new URLSearchParams(params)
        if (id) p.set('open', id); else p.delete('open')
        setParams(p, { replace: true })
      }} onSave={(id) => void save.run(id)} saving={save.busy} onAddMode={(m) => {
        const next = { ...f, modes: [...f.modes, m] }
        set({ modes: next.modes })
        setParams(new URLSearchParams(commuteUrl(next).split('?')[1]))
      }} />}
      {save.error && <ErrorBox message={save.error} onRetry={() => void save.retry()} />}

      {mode === 'group' && groupCode && (
        <>
          {groupError ? (
            <ErrorBox message={groupError}>
              <button className="btn-secondary" onClick={() => { draft.update((p) => ({ ...p, groupCode: null })); setParams({}) }}>Back to solo</button>
            </ErrorBox>
          ) : (
            <GroupPanel code={groupCode} group={group} type="commute">
              <p className="text-sm text-content-muted">
                Everyone leaves together from <strong>{nodeName(settings?.from ?? f.from)}</strong> at <strong>{settings?.time ?? f.time}</strong>. Each member picks their own destination above.
              </p>
              {isOwner ? (
                <button className="btn" onClick={() => void planForGroup.run()} disabled={planForGroup.busy}>
                  {planForGroup.busy ? 'Planning…' : group?.result ? 'Re-plan for the group' : 'Plan for the group'}
                </button>
              ) : (
                <p className="text-sm text-content-muted">The organiser will plan the trip. You'll get a notification here when it's ready.</p>
              )}
              {planForGroup.error && <ErrorBox message={planForGroup.error.includes('valid') ? 'Ask members to set their destination first.' : planForGroup.error} onRetry={() => void planForGroup.retry()} />}
            </GroupPanel>
          )}
          {group?.result && <GroupResultView r={group.result} myUid={user?.uid ?? ''} />}
        </>
      )}
    </div>
  )
}

function SoloResults({ result, open, setOpen, onSave, saving, onAddMode }: {
  result: ReturnType<typeof plan>; open: string | null; setOpen: (id: string | null) => void
  onSave: (id: string) => void; saving: boolean; onAddMode: (m: Mode) => void
}) {
  if (!result.routes.length) {
    return (
      <section className="card" role="alert">
        <h2 className="font-serif text-[28px] leading-tight text-content">No route found</h2>
        <p className="mt-1 text-sm text-content-secondary">{result.message}</p>
        {!!result.suggestions.length && (
          <div className="mt-3 flex flex-wrap gap-2">
            {result.suggestions.map((s) => (
              <button key={s.mode} className="btn-secondary" onClick={() => onAddMode(s.mode)}>
                {MODE_ICON[s.mode]} {s.text}
              </button>
            ))}
          </div>
        )}
      </section>
    )
  }
  return (
    <section aria-label="Routes" className="space-y-3">
      {result.baseline && (
        <p className="rounded-xl bg-accent-subtle p-4 text-body text-content-secondary">
          The usual plan — go to the nearest hub, <strong>{result.baseline.hubName}</strong>, and take the bus from there — takes{' '}
          <strong>{fmtDur(result.baseline.totalMin)}</strong>. The nearest bus stand is not always the fastest way out of the city.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {result.routes.map((r) => (
          <RouteCard
            key={r.id} route={r} nodes={graph.nodes} open={open === r.id}
            onToggle={() => setOpen(open === r.id ? null : r.id)}
            onSave={() => onSave(r.id)} saving={saving}
          />
        ))}
      </div>
    </section>
  )
}

function GroupResultView({ r, myUid }: { r: GroupResult; myUid: string }) {
  return (
    <section className="card space-y-4" aria-label="Group plan">
      <div>
        <div className="tz-kicker">Together, then apart</div><h2 className="font-serif text-[32px] leading-tight text-content">Group plan</h2>
        <p className="text-sm text-content-muted">
          Leave {nodeName(r.from)} at {r.time}. Shared part ₹{r.sharedPerPerson} per person (auto and cab fares split across the group).
        </p>
      </div>
      {r.shared ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-content-muted">Together</h3>
          <LegList legs={r.shared.legs} who="Group" />
        </div>
      ) : (
        <p className="text-sm">Everyone sets off separately from the start.</p>
      )}
      <div className="flex items-center gap-2" role="note">
        <span className="h-px flex-1 bg-accent" />
        <span className="rounded-full bg-accent px-3 py-1 text-sm font-bold text-accent-text">✂ Split at {r.splitName}{r.shared ? ` · ${fmtTime(r.shared.arrive)}` : ''}</span>
        <span className="h-px flex-1 bg-accent" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {r.members.map((m) => (
          <div key={m.id} className={`rounded-xl border p-3 ${m.id === myUid ? 'border-[var(--accent)] bg-accent-subtle' : 'border-edge'}`}>
            <p className="mb-2 font-semibold">
              {m.name}{m.id === myUid ? ' (you)' : ''} → {nodeName(m.to)}
              <span className="ml-2 text-sm font-normal text-content-muted">₹{m.perPerson} total{m.route ? ` · arrive ${fmtTime(m.route.arrive)}` : ''}</span>
            </p>
            {m.route ? <LegList legs={m.route.legs} who={m.name} /> : <p className="text-sm text-content-muted">Arrives at the split point — no onward travel.</p>}
          </div>
        ))}
      </div>
      {r.shared && <MapView legs={[...r.shared.legs, ...r.members.flatMap((m) => m.route?.legs ?? [])]} nodes={graph.nodes} />}
    </section>
  )
}
