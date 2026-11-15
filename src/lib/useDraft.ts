import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './auth'
import { db } from './firebase'
import type { SaveState } from './status'

type Stored<T> = { value: T; updatedAt: number }

const localKey = (uid: string, key: string) => `tripzy:draft:${uid}:${key}`

export function readLocalDraft<T>(uid: string, key: string): Stored<T> | null {
  try {
    return JSON.parse(localStorage.getItem(localKey(uid, key)) || 'null')
  } catch {
    return null
  }
}

export function clearLocalDraft(uid: string, key: string) {
  localStorage.removeItem(localKey(uid, key))
}

/**
 * useDraft(key): every change goes to localStorage immediately and to
 * Firestore users/{uid}/drafts/{key} after a short debounce. On load it
 * restores whichever copy is newer. Covers refresh restore, autosave,
 * offline retention and Firestore outages in one place.
 */
export function useDraft<T extends object>(key: string, initial: T) {
  const { user } = useAuth()
  const uid = user?.uid ?? 'anon'
  const [value, setValue] = useState<T>(() => readLocalDraft<T>(uid, key)?.value ?? initial)
  const [status, setStatus] = useState<SaveState>({ state: 'idle' })
  const [restored, setRestored] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef<Stored<T>>({ value, updatedAt: readLocalDraft<T>(uid, key)?.updatedAt ?? 0 })
  const initialRef = useRef(initial)

  const push = useCallback(async () => {
    if (!user) return
    if (!navigator.onLine) {
      setStatus({ state: 'local' })
      return
    }
    setStatus({ state: 'saving' })
    const snapshot = latest.current
    const write = setDoc(doc(db, 'users', user.uid, 'drafts', key), snapshot)
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 8000))
    try {
      const res = await Promise.race([write, timeout])
      if (latest.current !== snapshot) return // a newer change is on its way
      setStatus(res === 'timeout' ? { state: 'local' } : { state: 'saved', at: Date.now() })
    } catch {
      setStatus({ state: 'error' })
    }
  }, [user, key])

  // Restore: the newer of the local copy and the Firestore copy wins.
  useEffect(() => {
    const local = readLocalDraft<T>(uid, key)
    latest.current = local ?? { value: initialRef.current, updatedAt: 0 }
    setValue(latest.current.value)
    setRestored(false)
    if (!user) return
    let alive = true
    getDoc(doc(db, 'users', user.uid, 'drafts', key))
      .then((snap) => {
        const remote = snap.data() as Stored<T> | undefined
        if (!alive) return
        if (remote && remote.updatedAt > latest.current.updatedAt) {
          latest.current = remote
          localStorage.setItem(localKey(uid, key), JSON.stringify(remote))
          setValue(remote.value)
          setStatus({ state: 'saved', at: remote.updatedAt })
        } else if (local && (!remote || local.updatedAt > remote.updatedAt)) {
          void push() // a change made offline / during an outage: sync it now
        }
      })
      .catch(() => undefined) // offline with no cache: the local copy is already showing
      .finally(() => alive && setRestored(true))
    return () => {
      alive = false
    }
  }, [uid, key, user, push])

  // Sync anything kept locally once the connection comes back.
  useEffect(() => {
    const on = () => {
      if (status.state === 'local' || status.state === 'error') void push()
    }
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [status.state, push])

  useEffect(() => () => clearTimeout(timer.current), [])

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        latest.current = { value: v, updatedAt: Date.now() }
        localStorage.setItem(localKey(uid, key), JSON.stringify(latest.current))
        return v
      })
      setStatus(navigator.onLine ? { state: 'saving' } : { state: 'local' })
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void push(), 800)
    },
    [uid, key, push],
  )

  const reset = useCallback(() => update(initialRef.current), [update])

  return { value, update, reset, status, retry: push, restored }
}

/**
 * Write a page's draft from elsewhere (Tripzy AI fills Daily Traveller / Tourist Planner): saved
 * locally and to Firestore with a fresh timestamp, so the page restores this newer copy on open.
 */
export async function writeDraft<T>(uid: string, key: string, value: T): Promise<void> {
  const stored: Stored<T> = { value, updatedAt: Date.now() }
  try { localStorage.setItem(localKey(uid, key), JSON.stringify(stored)) } catch { /* storage blocked */ }
  try { await setDoc(doc(db, 'users', uid, 'drafts', key), stored as unknown as Record<string, unknown>) } catch { /* offline: local copy wins on this device */ }
}
