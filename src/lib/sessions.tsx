import { collection, deleteDoc, doc, onSnapshot } from 'firebase/firestore'
import { Plus, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from './auth'
import { db } from './firebase'
import { clearLocalDraft } from './useDraft'

/**
 * Saved journeys (Daily Traveller) and trips (Tourist Planner), like chats:
 * each one is its own draft at users/{uid}/drafts/{kind}-{id}. The original
 * single draft ("commute" / "tour") is kept as the first saved item.
 */
export type SessionKind = 'commute' | 'tour'
export type SessionItem = { id: string; title: string; updatedAt: number }

const activeKey = (uid: string, kind: SessionKind) => `tripzy:session:${uid}:${kind}`
const isOfKind = (id: string, kind: SessionKind) => id === kind || id.startsWith(`${kind}-`)

export const newSessionKey = (kind: SessionKind) => `${kind}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`

export function setActiveSession(uid: string, kind: SessionKind, key: string) {
  try { localStorage.setItem(activeKey(uid, kind), key) } catch { /* storage blocked */ }
}
function readActive(uid: string, kind: SessionKind): string {
  try { return localStorage.getItem(activeKey(uid, kind)) || kind } catch { return kind }
}

type Draft = { value?: Record<string, unknown>; updatedAt?: number }
function titleOf(kind: SessionKind, d: Draft): string {
  const v = d.value ?? {}
  if (kind === 'commute') {
    const from = (v.from as { name?: string } | undefined)?.name
    const to = (v.to as { name?: string } | undefined)?.name
    return from && to ? `${from} → ${to}` : from ? `From ${from}` : to ? `To ${to}` : 'New journey'
  }
  const a = (v.answers ?? {}) as { place?: { name?: string }; days?: number }
  const place = a.place?.name
  return place ? `${place}${a.days ? `, ${a.days} day${a.days === 1 ? '' : 's'}` : ''}` : 'New trip'
}

export function useSessions(kind: SessionKind) {
  const { user } = useAuth()
  const uid = user?.uid
  const nav = useNavigate()
  const base = kind === 'commute' ? '/commute' : '/tour'
  const [picked, setPicked] = useState<{ uid?: string; id: string } | null>(null)
  const active = picked && picked.uid === uid ? picked.id : uid ? readActive(uid, kind) : kind
  const [list, setList] = useState<SessionItem[]>([])

  useEffect(() => {
    if (!uid) return
    return onSnapshot(collection(db, 'users', uid, 'drafts'), (s) => {
      setList(s.docs.filter((d) => isOfKind(d.id, kind))
        .map((d) => ({ id: d.id, title: titleOf(kind, d.data() as Draft), updatedAt: Number((d.data() as Draft).updatedAt ?? 0) }))
        .sort((a, b) => b.updatedAt - a.updatedAt))
    }, () => undefined)
  }, [uid, kind])

  const select = useCallback((id: string) => {
    if (!uid) return
    setActiveSession(uid, kind, id)
    setPicked({ uid, id })
    nav(base) // a clean page: the selected item's own saved search is restored from its draft
  }, [uid, kind, nav, base])

  const create = useCallback(() => select(newSessionKey(kind)), [select, kind])

  const remove = useCallback(async (id: string) => {
    if (!uid) return
    await deleteDoc(doc(db, 'users', uid, 'drafts', id)).catch(() => undefined)
    clearLocalDraft(uid, id)
    if (id === active) {
      const next = list.find((s) => s.id !== id)
      select(next ? next.id : newSessionKey(kind))
    }
  }, [uid, active, list, select, kind])

  return { active, list, select, create, remove }
}

export function SessionStrip({ s, kind }: { s: ReturnType<typeof useSessions>; kind: SessionKind }) {
  const noun = kind === 'commute' ? 'journey' : 'trip'
  const items = s.list.some((x) => x.id === s.active) ? s.list : [{ id: s.active, title: kind === 'commute' ? 'New journey' : 'New trip', updatedAt: 0 }, ...s.list]
  return (
    <section aria-label={`Your ${noun}s`} className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
      <button type="button" className="btn btn-sm shrink-0" onClick={s.create}><Plus className="h-4 w-4" />New {noun}</button>
      {items.map((x) => {
        const on = x.id === s.active
        return (
          <span key={x.id} className={`chip shrink-0 !pe-1 ${on ? 'chip-on' : 'chip-off'}`}>
            <button type="button" className="max-w-[220px] truncate" onClick={() => s.select(x.id)} aria-current={on ? 'true' : undefined} title={x.title}>{x.title}</button>
            <button type="button" className="ms-1 grid h-6 w-6 place-items-center rounded-full opacity-60 hover:opacity-100" aria-label={`Delete ${x.title}`}
              onClick={() => { if (window.confirm(`Delete "${x.title}"?`)) void s.remove(x.id) }}><X className="h-3.5 w-3.5" /></button>
          </span>
        )
      })}
    </section>
  )
}
