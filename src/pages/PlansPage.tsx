/**
 * History of plans (opened from the dashboard's "Your data" boxes): tourist plans (solo and group),
 * Tourist Planner answers still in progress, Daily Traveller searches and saved routes, and AI chats.
 * Starting a new plan never deletes an old one; this is where the old ones are.
 */
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { ArrowRight, Luggage, MessageSquare, Plus, Route as RouteIcon, Trash2, Users } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../lib/auth'
import { removeDoc, routeDoc, tripDoc } from '../lib/db'
import { db } from '../lib/firebase'
import { toFriendly } from '../lib/request'
import { useSessions } from '../lib/sessions'
import { ErrorBox, Skeleton, useStatus } from '../lib/status'

type Row = { id: string; title?: string; start?: string; groupCode?: string; days?: unknown[]; updatedAt?: number; createdAt?: number; time?: string; summary?: string; messages?: unknown[] }

function useCol(uid: string, sub: 'trips' | 'routes' | 'chats', order: string) {
  const [items, setItems] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => onSnapshot(
    query(collection(db, 'users', uid, sub), orderBy(order, 'desc'), limit(50)),
    (s) => { setItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Row, 'id'>) }))); setError('') },
    (e) => setError(toFriendly(e).message),
  ), [uid, sub, order])
  return { items, error }
}

const ago = (t?: number) => {
  if (!t) return ''
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
const fmtDate = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

function Section({ id, icon, title, help, action, children }: { id: string; icon: ReactNode; title: string; help: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-edge pb-3">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-[28px] leading-tight text-content">{icon}{title}</h2>
          <p className="text-caption text-content-muted">{help}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Item({ to, onOpen, title, meta, onDelete }: { to?: string; onOpen?: () => void; title: string; meta: string; onDelete?: () => void }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-content">{title}</span>
        <span className="block truncate text-caption text-content-muted">{meta}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-content-faint" />
    </>
  )
  return (
    <li className="flex items-center gap-2 rounded-2xl border border-edge bg-surface-card p-3 transition hover:border-[var(--accent)]">
      {to ? <Link to={to} className="flex min-w-0 flex-1 items-center gap-3">{body}</Link> : <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-start">{body}</button>}
      {onDelete && <button type="button" aria-label={`Delete ${title}`} className="grid h-8 w-8 place-items-center rounded-full text-content-muted hover:bg-danger-soft hover:text-danger" onClick={onDelete}><Trash2 className="h-4 w-4" /></button>}
    </li>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-2xl border border-dashed border-edge p-4 text-body text-content-muted">{children}</p>

export default function PlansPage() {
  const { user } = useAuth()
  const uid = user!.uid
  const nav = useNavigate()
  const { confirm, toast } = useStatus()
  const trips = useCol(uid, 'trips', 'updatedAt')
  const routes = useCol(uid, 'routes', 'createdAt')
  const chats = useCol(uid, 'chats', 'updatedAt')
  const tours = useSessions('tour')
  const commutes = useSessions('commute')
  // a box on the dashboard opens this page at its section (#trips, #journeys, #chats, #answers)
  const { hash } = useLocation()
  const ready = !!trips.items && !!chats.items
  useEffect(() => {
    if (ready && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [ready, hash])

  const del = async (what: string, run: () => Promise<unknown>) => {
    if (!(await confirm(`Delete "${what}"? This can't be undone.`))) return
    try { await run(); toast('Deleted', 'success') } catch (e) { toast(toFriendly(e).message, 'error') }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-12 px-5 pb-24 pt-10 md:px-10">
      <header>
        <Link to="/#your-data" className="inline-flex items-center gap-1 text-body text-content-muted hover:text-content"><ArrowLeft className="h-4 w-4" />Home</Link>
        <div className="tz-chapter mt-4">Nothing you plan is lost.</div>
        <h1 className="tz-h1 mt-2 text-content">History</h1>
        <p className="mt-3 max-w-xl text-[16px] text-content-muted">Every trip, journey and chat you've made, on every device you sign in on. Starting something new never deletes the old one.</p>
      </header>

      <Section id="trips" icon={<Luggage className="h-6 w-6" />} title="Tourist plans" help="Day-by-day trips, yours and the groups you're in."
        action={<button type="button" className="btn btn-sm" onClick={tours.create}><Plus className="h-4 w-4" />New trip</button>}>
        {trips.error && <ErrorBox message={trips.error} />}
        {!trips.items ? <Skeleton lines={2} /> : trips.items.length ? (
          <ul className="space-y-2">
            {trips.items.map((t) => (
              <Item key={t.id} to={`/tour/${t.id}`} title={t.title ?? 'Trip'}
                meta={[t.groupCode ? 'Group trip' : '', t.start ? `from ${fmtDate(t.start)}` : '', Array.isArray(t.days) ? `${t.days.length} days` : '', ago(t.updatedAt)].filter(Boolean).join(' · ')}
                onDelete={() => void del(t.title ?? 'trip', () => removeDoc(tripDoc(uid, t.id)))} />
            ))}
          </ul>
        ) : <Empty>No trips yet. <Link className="btn-link" to="/tour">Plan one</Link> or ask Tripzy AI.</Empty>}
        {tours.list.some((s) => s.title && !/^Untitled/.test(s.title)) && (
          <>
            <p id="answers" className="scroll-mt-24 pt-2 text-caption font-semibold uppercase tracking-[0.14em] text-content-muted">Saved answers — reopen to edit or re-plan</p>
            <ul className="space-y-2">
              {tours.list.slice(0, 12).map((s) => (
                <Item key={s.id} onOpen={() => tours.select(s.id)} title={s.title} meta={`Tourist Planner · ${ago(s.updatedAt)}`}
                  onDelete={() => void del(s.title, () => tours.remove(s.id))} />
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section id="journeys" icon={<RouteIcon className="h-6 w-6" />} title="Daily Traveller" help="Journeys you searched and routes you saved — city trips and city-to-city."
        action={<button type="button" className="btn btn-sm" onClick={commutes.create}><Plus className="h-4 w-4" />New journey</button>}>
        {routes.error && <ErrorBox message={routes.error} />}
        {commutes.list.length ? (
          <ul className="space-y-2">
            {commutes.list.slice(0, 15).map((s) => (
              <Item key={s.id} onOpen={() => commutes.select(s.id)} title={s.title} meta={`Journey · ${ago(s.updatedAt)}`} onDelete={() => void del(s.title, () => commutes.remove(s.id))} />
            ))}
          </ul>
        ) : <Empty>No journeys yet. <Link className="btn-link" to="/commute">Plan a journey</Link>.</Empty>}
        {!!routes.items?.length && (
          <>
            <p id="routes" className="scroll-mt-24 pt-2 text-caption font-semibold uppercase tracking-[0.14em] text-content-muted">Saved routes</p>
            <ul className="space-y-2">
              {routes.items.map((r) => (
                <Item key={r.id} onOpen={() => nav('/')} title={r.title ?? 'Route'} meta={[r.time ? `at ${r.time}` : '', r.summary ?? '', ago(r.createdAt)].filter(Boolean).join(' · ')}
                  onDelete={() => void del(r.title ?? 'route', () => removeDoc(routeDoc(uid, r.id)))} />
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section id="chats" icon={<MessageSquare className="h-6 w-6" />} title="Tripzy AI chats" help="Each chat remembers the plan it was about."
        action={<Link className="btn btn-sm" to="/ai?new=1"><Plus className="h-4 w-4" />New chat</Link>}>
        {chats.error && <ErrorBox message={chats.error} />}
        {!chats.items ? <Skeleton lines={2} /> : chats.items.length ? (
          <ul className="space-y-2">
            {chats.items.map((c) => (
              <Item key={c.id} to={`/ai/${c.id}`} title={c.title ?? 'Chat'} meta={`${Array.isArray(c.messages) ? c.messages.length : 0} messages · ${ago(c.updatedAt)}`} />
            ))}
          </ul>
        ) : <Empty>No chats yet. <Link className="btn-link" to="/ai">Ask Tripzy AI</Link>.</Empty>}
      </Section>

      <p className="flex items-center gap-2 text-caption text-content-muted"><Users className="h-3.5 w-3.5" />Group trips you joined appear under Tourist plans once the organiser creates the plan.</p>
    </div>
  )
}
