import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from 'firebase/auth'
import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { useAuth } from '../lib/auth'
import { savePrefs } from '../lib/db'
import { auth, usingEmulators } from '../lib/firebase'
import { request } from '../lib/request'
import { DEFAULT_PREFS } from '../lib/types'
import { nameError, passwordError, validEmail } from '../lib/validate'

type Tab = 'login' | 'register' | 'reset'

function authMessage(e: unknown): string {
  const code = String((e as { code?: string })?.code ?? '')
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-login'))
    return 'Email or password is wrong. Check them and try again, or reset your password.'
  if (code.includes('email-already-in-use')) return 'An account with this email already exists. Log in instead.'
  if (code.includes('weak-password')) return 'Password must be at least 6 characters.'
  if (code.includes('invalid-email')) return 'That email address does not look right.'
  if (code.includes('too-many-requests')) return 'Too many attempts. Wait a minute and try again.'
  if ((e as { message?: string })?.message === 'timeout') return 'Signing in is taking too long. Check your connection and try again.'
  if (code.includes('network-request-failed') || !navigator.onLine)
    return "Can't reach the sign-in service. Check your connection and try again."
  return (e as { message?: string })?.message || 'Something went wrong. Please try again.'
}

export default function LoginPage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next') || '/'
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={next.startsWith('/') ? next : '/'} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    setInfo('')
    const problem =
      (tab === 'register' && nameError(name)) ||
      (!validEmail(email) && 'Please enter a valid email address.') ||
      (tab !== 'reset' && passwordError(password)) ||
      ''
    if (problem) return setError(problem)
    setBusy(true)
    try {
      if (tab === 'login') {
        await request(() => signInWithEmailAndPassword(auth, email.trim(), password), { retries: 0, key: 'login' })
      } else if (tab === 'register') {
        const cred = await request(() => createUserWithEmailAndPassword(auth, email.trim(), password), { retries: 0, key: 'register' })
        await updateProfile(cred.user, { displayName: name.trim() })
        await savePrefs(cred.user.uid, name.trim(), DEFAULT_PREFS).catch(() => undefined)
      } else {
        await request(() => sendPasswordResetEmail(auth, email.trim()), { retries: 0, key: 'reset' })
        setInfo(
          usingEmulators
            ? 'Reset link created. In local mode it appears in the emulator log / UI at localhost:4000 instead of an email.'
            : 'If an account exists for that email, a reset link is on its way. Check your inbox.',
        )
      }
    } catch (err) {
      setError(authMessage((err as { cause?: unknown })?.cause ?? err))
    } finally {
      setBusy(false)
    }
  }

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => { setTab(t); setError(''); setInfo('') }}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${tab === t ? 'bg-white shadow-sm' : 'text-slate-600'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-bold">Welcome to Tripzy</h1>
      <p className="mb-5 text-slate-600">Plan your daily commute and your next trip in one place.</p>
      {params.get('expired') && (
        <p role="alert" className="mb-4 rounded-xl bg-amber-100 p-3 text-sm text-amber-900">
          Please log in again. Your session ended — your draft is kept and you'll return to the same page.
        </p>
      )}
      <div className="card">
        <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
          {tabBtn('login', 'Log in')}
          {tabBtn('register', 'Register')}
          {tabBtn('reset', 'Forgot password')}
        </div>
        <form onSubmit={submit} noValidate className="space-y-3">
          {tab === 'register' && (
            <div>
              <label className="label" htmlFor="name">Your name</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          {tab !== 'reset' && (
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password" type="password" className="input" value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
              />
              {tab === 'register' && <p className="mt-1 text-xs text-slate-500">At least 6 characters.</p>}
            </div>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {info && <p role="status" className="rounded-lg bg-brand-50 p-3 text-sm text-brand-800">{info}</p>}
          <button className="btn w-full" disabled={busy}>
            {busy ? 'Please wait…' : tab === 'login' ? 'Log in' : tab === 'register' ? 'Create account' : 'Send reset link'}
          </button>
        </form>
      </div>
      {usingEmulators && (
        <p className="mt-3 text-center text-xs text-slate-500">Local mode: accounts live in the Firebase emulator on this computer.</p>
      )}
    </div>
  )
}
