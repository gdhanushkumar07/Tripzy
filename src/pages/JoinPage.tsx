import { useEffect, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../lib/auth'
import { CODE_RE, joinGroup } from '../lib/db'
import { ErrorBox, useAction } from '../lib/status'

/** /join/:code — join a commute or tour group, then go to that module. */
export default function JoinPage() {
  const { code = '' } = useParams()
  const upper = code.toUpperCase()
  const { user, profile } = useAuth()
  const nav = useNavigate()
  const valid = CODE_RE.test(upper)
  const join = useAction(async () => {
    const g = await joinGroup(upper, user!.uid, profile.name || user!.email?.split('@')[0] || 'Member')
    nav(`/${g.type === 'tour' ? 'tour' : 'commute'}?group=${upper}`, { replace: true })
  })
  const started = useRef(false)
  useEffect(() => {
    if (valid && user && !started.current) {
      started.current = true
      void join.run()
    }
  }, [valid, user, join])

  const message = !valid
    ? 'That invite code is not valid. Codes are 6 letters and numbers, like K7M2QX.'
    : join.error.includes('find')
      ? "This group doesn't exist any more. Ask for a new invite link."
      : join.error.includes('session') || join.error.includes('valid')
        ? 'This invite can’t be used — the group may be full. Ask the organiser for a new link.'
        : join.error

  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-2xl font-bold">Joining group {valid ? upper : ''}</h1>
      {message ? (
        <ErrorBox message={message} onRetry={valid ? () => void join.retry() : undefined}>
          <Link className="btn-secondary" to="/">Go to dashboard</Link>
        </ErrorBox>
      ) : (
        <p className="text-slate-600" role="status">Adding you to the group…</p>
      )}
    </div>
  )
}
