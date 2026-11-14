import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { auth, db } from './firebase'
import { Skeleton } from './status'
import { DEFAULT_PREFS, type Profile } from './types'

type AuthCtx = { user: User | null; profile: Profile; loading: boolean; expired: boolean; logout: () => Promise<void> }

const Ctx = createContext<AuthCtx | null>(null)

export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}

/** Last signed-in uid, so drafts can be found again after an expired session. */
export const LAST_UID_KEY = 'tripzy:lastUid'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile>({ name: '', prefs: DEFAULT_PREFS })
  const [loading, setLoading] = useState(true)
  const [expired, setExpired] = useState(false)
  const hadUser = useRef(false)
  const loggingOut = useRef(false)

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        if (!u && hadUser.current && !loggingOut.current) setExpired(true)
        if (u) {
          setExpired(false)
          localStorage.setItem(LAST_UID_KEY, u.uid)
        }
        hadUser.current = !!u
        loggingOut.current = false
        setUser(u)
        setLoading(false)
      }),
    [],
  )

  useEffect(() => {
    if (!user) return
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        const d = snap.data() as Partial<Profile> | undefined
        setProfile({
          name: d?.name || user.displayName || user.email?.split('@')[0] || 'traveller',
          prefs: { ...DEFAULT_PREFS, ...(d?.prefs ?? {}) },
        })
      },
      () => undefined, // permission errors surface through the auth listener
    )
  }, [user])

  const logout = async () => {
    loggingOut.current = true
    await signOut(auth)
  }

  return <Ctx.Provider value={{ user, profile, loading, expired, logout }}>{children}</Ctx.Provider>
}

/** Auth guard: unauthenticated users go to /login and come back to the page they wanted. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, expired } = useAuth()
  const loc = useLocation()
  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Skeleton lines={4} />
      </div>
    )
  }
  if (!user) {
    const next = encodeURIComponent(loc.pathname + loc.search)
    return <Navigate to={`/login?next=${next}${expired ? '&expired=1' : ''}`} replace />
  }
  return <>{children}</>
}
