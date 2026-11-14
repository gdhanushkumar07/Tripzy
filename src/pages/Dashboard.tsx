import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { commuteUrl, graph, type CommuteForm } from '../commute/CommutePage'
import { useAuth } from '../lib/auth'
import { removeDoc, routeDoc, savePrefs, tripDoc } from '../lib/db'
import { db } from '../lib/firebase'
import { toFriendly } from '../lib/request'
import { ErrorBox, Skeleton, useAction, useStatus } from '../lib/status'
import { MODES, MODE_ICON, MODE_LABEL, type Mode, type Prefs } from '../lib/types'
import { readLocalDraft } from '../lib/useDraft'
import { budgetError, optNum, transfersError } from '../lib/validate'
import type { TourDraft } from '../tour/TourPage'

type SavedRoute = { id: string; from: string; to: string; time: string; modes: Mode[]; budget: number | null; maxTransfers: number | null; title: string; summary?: string }
type SavedTrip = { id: string; title: string; start?: string; groupCode?: string }

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

export default function Dashboard() {
  const { user, profile } = useAuth()
  const uid = user!.uid
  const nav = useNavigate()
  const { confirm, toast } = useStatus()
  const routes = useList<SavedRoute>(uid, 'routes', 'createdAt')
  const trips = useList<SavedTrip>(uid, 'trips', 'updatedAt')

  const commuteDraft = readLocalDraft<CommuteForm>(uid, 'commute')?.value
  const tourDraft = readLocalDraft<TourDraft>(uid, 'tour')?.value
  const answered = tourDraft ? Object.values(tourDraft.answers).filter((v) => (Array.isArray(v) ? v.length : v !== undefined && v !== '')).length : 0

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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Welcome, {profile.name || 'traveller'} 👋</h1>

      {((commuteDraft?.touched && commuteDraft.from) || (answered > 0 && !tourDraft?.doneTripId)) && (
        <section className="card border-brand-600 bg-brand-50" aria-label="Continue where you left off">
          <h2 className="font-semibold">Continue where you left off</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {commuteDraft?.touched && commuteDraft.from && (
              <Link className="btn" to={commuteDraft.groupCode ? `/commute?group=${commuteDraft.groupCode}` : commuteDraft.to ? commuteUrl(commuteDraft) : '/commute'}>
                🚇 Commute: {graph.nodes.get(commuteDraft.from)?.name}{commuteDraft.to ? ` → ${graph.nodes.get(commuteDraft.to)?.name}` : ''}
              </Link>
            )}
            {answered > 0 && !tourDraft?.doneTripId && (
              <Link className="btn" to={tourDraft?.groupCode ? `/tour?group=${tourDraft.groupCode}` : '/tour'}>🧳 Trip questions: {answered} of 12 answered</Link>
            )}
          </div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/commute" className="card block transition hover:border-brand-600 hover:shadow-md">
          <span className="text-4xl" aria-hidden>🚇</span>
          <h2 className="mt-2 text-xl font-bold">Daily Traveller</h2>
          <p className="mt-1 text-sm text-slate-600">Cheapest, fastest and fewest-transfer routes that mix metro, bus, auto and more. Solo or as a group that splits up on the way.</p>
        </Link>
        <Link to="/tour" className="card block transition hover:border-brand-600 hover:shadow-md">
          <span className="text-4xl" aria-hidden>🧳</span>
          <h2 className="mt-2 text-xl font-bold">Tourist Planner</h2>
          <p className="mt-1 text-sm text-slate-600">Answer 12 quick questions and get a day-by-day plan with costs. Plan alone or with friends.</p>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card" aria-label="Saved routes">
          <h2 className="mb-2 font-semibold">Saved routes</h2>
          {routes.error ? <ErrorBox message={routes.error} /> : !routes.items ? <Skeleton lines={2} /> : !routes.items.length ? (
            <p className="text-sm text-slate-500">No saved routes yet. Find a route and tap “Save route”.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {routes.items.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-2">
                  <button className="min-h-11 flex-1 text-left" onClick={() => nav(commuteUrl(r))}>
                    <span className="block text-sm font-semibold">{r.title} · {r.time}</span>
                    {r.summary && <span className="block text-xs text-slate-500">{r.summary}</span>}
                  </button>
                  <button className="text-xs font-semibold text-red-700 underline" onClick={() => void del('route', r.id, r.title)} aria-label={`Delete ${r.title}`}>Delete</button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-label="Saved trips">
          <h2 className="mb-2 font-semibold">Saved trips</h2>
          {trips.error ? <ErrorBox message={trips.error} /> : !trips.items ? <Skeleton lines={2} /> : !trips.items.length ? (
            <p className="text-sm text-slate-500">No trips yet. Answer the 12 questions to create one.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {trips.items.map((t) => (
                <li key={t.id} className="flex items-center gap-2 py-2">
                  <button className="min-h-11 flex-1 text-left" onClick={() => nav(`/tour/${t.id}`)}>
                    <span className="block text-sm font-semibold">{t.title}</span>
                    {t.start && <span className="block text-xs text-slate-500">from {t.start}</span>}
                  </button>
                  <button className="text-xs font-semibold text-red-700 underline" onClick={() => void del('trip', t.id, t.title)} aria-label={`Delete ${t.title}`}>Delete</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <PrefsForm key={JSON.stringify(profile.prefs)} name={profile.name} prefs={profile.prefs} uid={uid} />
    </div>
  )
}

function PrefsForm({ uid, name, prefs }: { uid: string; name: string; prefs: Prefs }) {
  const { toast } = useStatus()
  const [modes, setModes] = useState<Mode[]>(prefs.modes)
  const [budget, setBudget] = useState(prefs.budget?.toString() ?? '')
  const [maxT, setMaxT] = useState(prefs.maxTransfers?.toString() ?? '')
  const [err, setErr] = useState('')
  const saveAction = useAction(async () => {
    const e = budgetError(optNum(budget)) || transfersError(optNum(maxT)) || (!modes.length ? 'Pick at least one mode.' : '')
    setErr(e)
    if (e) return
    const res = await savePrefs(uid, name, { modes, budget: optNum(budget), maxTransfers: optNum(maxT) })
    toast(res === 'local' ? 'Preferences saved on this device — will sync when online' : 'Preferences saved', 'success')
  })
  return (
    <section className="card" aria-label="Preferences">
      <h2 className="font-semibold">Your preferences</h2>
      <p className="mb-3 text-sm text-slate-600">Used to preselect modes on the Daily Traveller form.</p>
      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => {
          const on = modes.includes(m)
          return (
            <button key={m} type="button" aria-pressed={on} className={`chip ${on ? 'chip-on' : 'chip-off'}`} onClick={() => setModes(on ? modes.filter((x) => x !== m) : [...modes, m])}>
              <span aria-hidden>{MODE_ICON[m]}</span>{MODE_LABEL[m]}
            </button>
          )
        })}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="pbudget">Default budget (₹)</label>
          <input id="pbudget" className="input" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))} placeholder="No limit" />
        </div>
        <div>
          <label className="label" htmlFor="pmax">Max transfers</label>
          <input id="pmax" className="input" inputMode="numeric" value={maxT} onChange={(e) => setMaxT(e.target.value.replace(/[^\d]/g, ''))} placeholder="Any" />
        </div>
        <div className="flex items-end">
          <button className="btn w-full" onClick={() => void saveAction.run()} disabled={saveAction.busy}>{saveAction.busy ? 'Saving…' : 'Save preferences'}</button>
        </div>
      </div>
      {err && <p className="field-error">{err}</p>}
      {saveAction.error && <ErrorBox message={saveAction.error} onRetry={() => void saveAction.retry()} />}
    </section>
  )
}
