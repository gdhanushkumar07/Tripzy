/**
 * One wrapper for every network / AI / Firestore call:
 * timeout, 2 retries with backoff, de-duplication of identical in-flight calls,
 * and plain-language error messages.
 */
export class FriendlyError extends Error {
  constructor(
    message: string,
    public kind: 'offline' | 'timeout' | 'auth' | 'unavailable' | 'notfound' | 'invalid' | 'unknown',
    public retryable: boolean,
  ) {
    super(message)
  }
}

export type RequestOptions = { key?: string; timeoutMs?: number; retries?: number; backoffMs?: number }

const inflight = new Map<string, Promise<unknown>>()

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new FriendlyError('timeout', 'timeout', true)), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

/** Turn any thrown value into a FriendlyError with a message a first-time user understands. */
export function toFriendly(err: unknown): FriendlyError {
  const f = classify(err)
  if (f !== err && f.cause === undefined) f.cause = err
  return f
}

function classify(err: unknown): FriendlyError {
  if (err instanceof FriendlyError) {
    if (err.message !== 'timeout') return err
    return new FriendlyError('This is taking longer than it should. Check your connection and try again.', 'timeout', true)
  }
  const e = err as { code?: string; message?: string; name?: string }
  const code = String(e?.code ?? '')
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return new FriendlyError("You're offline. Your data is kept on this device; try again when you're back online.", 'offline', true)
  }
  if (code.includes('permission-denied') || code.includes('unauthenticated') || code.includes('user-token-expired')) {
    return new FriendlyError('Your session has expired. Please log in again — your draft is kept.', 'auth', false)
  }
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('network-request-failed') || e?.name === 'TypeError') {
    return new FriendlyError("The server isn't reachable right now. Your changes are kept on this device.", 'unavailable', true)
  }
  if (code.includes('not-found')) return new FriendlyError("We couldn't find that. It may have been deleted.", 'notfound', false)
  if (code.includes('invalid-argument') || code.includes('failed-precondition')) {
    return new FriendlyError('Some of the details are not valid. Please check the form.', 'invalid', false)
  }
  return new FriendlyError('Something went wrong. Please try again.', 'unknown', true)
}

export function request<T>(fn: () => Promise<T>, opts: RequestOptions = {}): Promise<T> {
  const { key, timeoutMs = 10000, retries = 2, backoffMs = 400 } = opts
  if (key && inflight.has(key)) return inflight.get(key) as Promise<T>
  const run = (async () => {
    let last: FriendlyError | null = null
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await withTimeout(fn(), timeoutMs)
      } catch (err) {
        last = toFriendly(err)
        if (!last.retryable || last.kind === 'offline' || attempt === retries) break
        await wait(backoffMs * 3 ** attempt)
      }
    }
    throw last
  })()
  if (key) {
    inflight.set(key, run)
    run.then(() => inflight.delete(key), () => inflight.delete(key))
  }
  return run
}
