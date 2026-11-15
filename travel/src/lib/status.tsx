import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { toFriendly } from './request'

/**
 * The one status module: offline banner, save status, toasts, skeletons,
 * error box with Retry, confirm dialog, unsaved-changes warning and a
 * busy-guarded action hook for submit buttons.
 */

type Toast = { id: number; text: string; kind: 'info' | 'success' | 'error'; action?: { label: string; run: () => void } }
type ConfirmReq = { text: string; confirmLabel: string; resolve: (ok: boolean) => void }
type Ctx = {
  toast: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void
  confirm: (text: string, confirmLabel?: string) => Promise<boolean>
}

const StatusCtx = createContext<Ctx | null>(null)

export function useStatus(): Ctx {
  const c = useContext(StatusCtx)
  if (!c) throw new Error('useStatus outside StatusProvider')
  return c
}

export function StatusProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [ask, setAsk] = useState<ConfirmReq | null>(null)
  const seq = useRef(0)

  const toast = useCallback<Ctx['toast']>((text, kind = 'info', action) => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-2), { id, text, kind, action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 9000 : 5000)
  }, [])

  const confirm = useCallback<Ctx['confirm']>(
    (text, confirmLabel = 'Delete') => new Promise<boolean>((resolve) => setAsk({ text, confirmLabel, resolve })),
    [],
  )

  const close = (ok: boolean) => {
    ask?.resolve(ok)
    setAsk(null)
  }

  return (
    <StatusCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[3000] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`tz-rise pointer-events-auto flex max-w-lg items-center gap-3 rounded-2xl bg-inverse px-4 py-3 text-body text-inverse-text shadow-modal ${
              t.kind === 'error' ? 'ring-2 ring-[var(--danger)]' : t.kind === 'success' ? 'ring-2 ring-[var(--accent)]' : ''
            }`}
          >
            <span>{t.text}</span>
            {t.action && (
              <button className="font-semibold text-[var(--tz-sun)] underline underline-offset-2" onClick={t.action.run}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      {ask && (
        <div className="fixed inset-0 z-[3001] grid place-items-center bg-[var(--overlay)] p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-text">
          <div className="tz-rise w-full max-w-sm rounded-[22px] border border-edge bg-surface-card p-6 shadow-modal">
            <p id="confirm-text" className="font-serif text-[24px] leading-tight text-content">{ask.text}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => close(false)} autoFocus>Cancel</button>
              <button className="btn !bg-[var(--danger)] !text-white hover:opacity-90" onClick={() => close(true)}>{ask.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </StatusCtx.Provider>
  )
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div role="status" className="bg-warning-soft px-4 py-2 text-center text-caption font-medium text-warning">
      You're offline. Everything you type is kept on this device and will sync when you're back online.
    </div>
  )
}

export type SaveState = { state: 'idle' | 'saving' | 'saved' | 'local' | 'error'; at?: number }

const hhmm = (t?: number) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')

export function SaveStatus({ status, onRetry }: { status: SaveState; onRetry?: () => void }) {
  const text =
    status.state === 'saving' ? 'Saving…'
    : status.state === 'saved' ? `Saved ${hhmm(status.at)}`
    : status.state === 'local' ? 'Saved on this device — will sync when online'
    : status.state === 'error' ? 'Not saved to the cloud yet — kept on this device'
    : ''
  if (!text) return null
  return (
    <span className="inline-flex items-center gap-2 text-caption text-content-muted" role="status">
      <span className={`h-2 w-2 rounded-full ${status.state === 'saved' ? 'bg-[var(--success)]' : status.state === 'saving' ? 'bg-[var(--text-faint)]' : 'bg-[var(--warning)]'}`} />
      {text}
      {(status.state === 'error' || status.state === 'local') && onRetry && navigator.onLine && (
        <button className="font-semibold text-accent-on underline underline-offset-2" onClick={onRetry}>Retry</button>
      )}
    </span>
  )
}

export function Skeleton({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface-tertiary motion-reduce:animate-none" />
      ))}
    </div>
  )
}

export function ErrorBox({ message, onRetry, children }: { message: string; onRetry?: () => void; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-2xl bg-danger-soft p-4 text-body text-danger">
      <p>{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onRetry && <button className="btn" onClick={onRetry}>Retry</button>}
        {children}
      </div>
    </div>
  )
}

/** Warn on tab close / reload only while something is not saved anywhere yet. */
export function useUnsavedWarning(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [unsaved])
}

/**
 * Busy-guarded async action for submit buttons: ignores clicks while running,
 * keeps a plain-language error and lets the user retry the last call.
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const lastArgs = useRef<A | null>(null)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (busyRef.current) return undefined
    busyRef.current = true
    lastArgs.current = args
    setBusy(true)
    setError('')
    try {
      return await fnRef.current(...args)
    } catch (e) {
      setError(toFriendly(e).message)
      return undefined
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const retry = useCallback(() => (lastArgs.current ? run(...lastArgs.current) : undefined), [run])
  return { run, busy, error, retry, clearError: () => setError('') }
}
