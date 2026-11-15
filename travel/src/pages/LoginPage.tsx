import { createUserWithEmailAndPassword, getAdditionalUserInfo, GoogleAuthProvider, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, updateProfile } from 'firebase/auth'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { credit } from '../ui/photos'
import { Brand, Emblem } from '../ui/PublicLayout'
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

  const google = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      const cred = await signInWithPopup(auth, provider).catch(async (e) => {
        // popups blocked (some mobile browsers): fall back to a full-page redirect
        if (String((e as { code?: string }).code).includes('popup-blocked')) { await signInWithRedirect(auth, provider); return null }
        throw e
      })
      if (cred && getAdditionalUserInfo(cred)?.isNewUser) {
        await savePrefs(cred.user.uid, (cred.user.displayName ?? cred.user.email?.split('@')[0] ?? 'Traveller').slice(0, 40), DEFAULT_PREFS).catch(() => undefined)
      }
    } catch (err) {
      const code = String((err as { code?: string }).code ?? '')
      setError(code.includes('popup-closed') || code.includes('cancelled-popup') ? 'Google sign-in was closed before it finished.'
        : code.includes('operation-not-allowed') ? 'Google sign-in is not enabled for this Firebase project yet (Authentication → Sign-in method → Google).'
        : code.includes('unauthorized-domain') ? 'This domain is not authorised for Google sign-in (Firebase → Authentication → Settings → Authorised domains).'
        : authMessage(err))
    } finally {
      setBusy(false)
    }
  }

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
      className={`h-9 flex-1 rounded-lg px-3 text-body font-medium transition-colors ${tab === t ? 'bg-surface-card text-content shadow-sm' : 'text-content-muted hover:text-content'}`}
    >
      {label}
    </button>
  )

  const heading = tab === 'login' ? 'Welcome back' : tab === 'register' ? 'Create your account' : 'Reset your password'

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Left: the editorial photograph with the Tripzy mark and tagline (original design). */}
      <div className="relative hidden flex-1 items-center justify-center overflow-hidden lg:flex">
        <img src={`${import.meta.env.BASE_URL}stories/jal-mahal.webp`} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(24,33,31,.35) 0%, rgba(24,33,31,.55) 55%, rgba(24,33,31,.85) 100%)' }} />
        <div className="relative z-[1] px-10 text-center">
          <div className="mb-3 flex items-center justify-center gap-3" style={{ filter: 'drop-shadow(0 2px 10px rgba(4,8,20,0.55))' }}>
            <Emblem className="h-14 w-14" light />
            <span className="font-serif text-[64px] leading-none text-white">Tripzy</span>
          </div>
          <h2 className="whitespace-pre-line font-serif text-[clamp(32px,2.95vw,46px)] leading-[1.1] text-white" style={{ textShadow: '0 2px 10px rgba(4,8,20,0.55), 0 0 34px rgba(4,8,20,0.5)' }}>
            {'Every journey\nhas a story.'}
          </h2>
          <p className="mt-3 text-[clamp(12px,1.05vw,16px)] text-white/65" style={{ textShadow: '0 1px 8px rgba(4,8,20,0.6)' }}>
            Smarter daily commutes and trips planned around you.
          </p>
        </div>
        <p className="tz-credit absolute bottom-3 right-4">{credit('jal-mahal')}</p>
      </div>

      {/* Right: the form. */}
      <div className="flex flex-1 items-center justify-center px-6 py-8">
        <div className="w-full max-w-[400px]">
          <p className="mb-5 text-sm text-content-muted">Sign in to your travel workspace for routes, group tours and AI chats. Your existing Tripzy trips use their original account. <a href="/dashboard" className="underline">Back to my trips</a></p>
          <div className="mb-9 flex flex-col items-center gap-1.5 lg:hidden">
            <Brand />
            <p className="font-serif text-[18px] italic text-content-muted">Every journey has a story.</p>
          </div>
          <Link to="/" className="tz-link mb-6 hidden text-caption text-content-muted lg:inline-block">← Back to the story</Link>
          <h1 className="tz-h3 text-content">{heading}</h1>
          <p className="mt-1 text-body text-content-muted">Plan your daily commute and your next trip in one place.</p>
          {params.get('expired') && (
            <p role="alert" className="mt-5 rounded-2xl bg-warning-soft px-4 py-3 text-body text-warning">
              Please log in again. Your session ended — your draft is kept and you'll return to the same page.
            </p>
          )}
          <div className="mt-6 flex gap-1 rounded-xl bg-surface-secondary p-1" role="tablist">
            {tabBtn('login', 'Log in')}
            {tabBtn('register', 'Register')}
            {tabBtn('reset', 'Forgot?')}
          </div>
          {tab !== 'reset' && (
            <>
              <button type="button" onClick={() => void google()} disabled={busy} className="btn-secondary mt-6 h-12 w-full">
                <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
                Continue with Google
              </button>
              <div className="my-5 flex items-center gap-3 text-caption text-content-faint"><span className="h-px flex-1 bg-[var(--border-primary)]" />or with email<span className="h-px flex-1 bg-[var(--border-primary)]" /></div>
            </>
          )}
          <form onSubmit={submit} noValidate className={tab === 'reset' ? 'mt-6 space-y-4' : 'space-y-4'}>
            {tab === 'register' && (
              <div>
                <label className="label" htmlFor="name">Your name</label>
                <input id="name" className="tz-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="tz-input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
            </div>
            {tab !== 'reset' && (
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input
                  id="password" type="password" className="tz-input" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
                />
                {tab === 'register' && <p className="mt-1.5 text-caption text-content-faint">At least 6 characters.</p>}
              </div>
            )}
            {error && <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-body text-danger">{error}</p>}
            {info && <p role="status" className="rounded-2xl bg-accent-subtle px-4 py-3 text-body text-accent-on">{info}</p>}
            <button className="btn h-12 w-full" disabled={busy}>
              {busy ? 'Please wait…' : tab === 'login' ? 'Sign in' : tab === 'register' ? 'Create account' : 'Send reset link'}
            </button>
          </form>
          {usingEmulators && (
            <p className="mt-4 text-center text-caption text-content-faint">Local mode: accounts live in the Firebase emulator on this computer.</p>
          )}
        </div>
      </div>
    </div>
  )
}
