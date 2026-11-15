import { User, Users } from 'lucide-react'
import { onSnapshot } from './localstore'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from './auth'
import { groupDoc, removeMember, type Group, type GroupType } from './db'
import { toFriendly } from './request'
import { useStatus } from './status'

/** Live group document (onSnapshot). Calls onResult when a new result arrives after the page opened. */
export function useGroup<R extends { at?: number }>(code: string | null, onResult?: (r: R) => void) {
  const [group, setGroup] = useState<Group<R> | null>(null)
  const [error, setError] = useState('')
  const seen = useRef<number | null>(null)
  const cb = useRef(onResult)
  useEffect(() => {
    cb.current = onResult
  })

  useEffect(() => {
    if (!code) return
    seen.current = null
    return onSnapshot(
      groupDoc(code),
      (snap) => {
        const g = snap.data() as Group<R> | undefined
        if (!g) {
          setError('This group no longer exists.')
          return
        }
        setError('')
        setGroup(g)
        const at = g.result?.at ?? 0
        if (seen.current !== null && at > seen.current && g.result) cb.current?.(g.result)
        seen.current = at
      },
      (e) => {
        const f = toFriendly(e)
        setError(f.kind === 'auth' ? "You're not a member of this group (or you were removed). Ask for a new invite link." : f.message)
      },
    )
  }, [code])

  return { group: code ? group : null, error: code ? error : '' }
}

export function GroupPanel({ code, group, type, children }: { code: string; group: Group | null; type: GroupType; children?: React.ReactNode }) {
  const { user } = useAuth()
  const { toast, confirm } = useStatus()
  const link = `${window.location.origin}/join/${code}`
  const isOwner = group?.ownerUid === user?.uid

  const copy = async () => {
    try {
      if (navigator.share && /Mobi/.test(navigator.userAgent)) await navigator.share({ title: 'Join my Tripzy group', url: link })
      else {
        await navigator.clipboard.writeText(link)
        toast('Invite link copied', 'success')
      }
    } catch {
      toast(`Copy this link: ${link}`)
    }
  }

  const remove = async (uid: string, name: string) => {
    if (!(await confirm(`Remove ${name} from the group?`, 'Remove'))) return
    try {
      await removeMember(code, uid)
      toast(`${name} removed`, 'success')
    } catch (e) {
      toast(toFriendly(e).message, 'error')
    }
  }

  return (
    <section className="card space-y-4" aria-label="Group">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-content-muted">
          Group code <strong className="font-mono text-base text-content">{code}</strong>
        </p>
        <button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void copy()}>Share invite link</button>
        <span className="text-xs text-content-muted break-all">{link}</span>
      </div>
      {!group ? (
        <div className="h-10 animate-pulse rounded-lg bg-surface-tertiary" />
      ) : (
        <ul className="divide-y divide-edge" aria-label="Members">
          {group.memberUids.map((uid) => {
            const m = group.members[uid]
            if (!m) return null
            return (
              <li key={uid} className="flex items-center gap-2 py-2 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${m.ready ? 'bg-accent' : 'bg-surface-tertiary'}`} aria-hidden />
                <span className="font-medium">{m.name}{uid === user?.uid ? ' (you)' : ''}{uid === group.ownerUid ? ' · organiser' : ''}</span>
                <span className="text-content-muted">{m.ready ? (type === 'commute' ? ((group?.settings as { kind?: string } | undefined)?.kind === 'meet' ? 'start set' : 'destination set') : 'answers in') : 'waiting…'}</span>
                {isOwner && uid !== user?.uid && (
                  <button className="ml-auto text-xs font-semibold text-danger underline" onClick={() => void remove(uid, m.name)}>
                    Remove
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {children}
    </section>
  )
}

export function ModeToggle({ value, onChange, disabled }: { value: 'solo' | 'group'; onChange: (v: 'solo' | 'group') => void; disabled?: boolean }) {
  return (
    <div className="inline-flex gap-1 rounded-xl bg-surface-secondary p-1" role="radiogroup" aria-label="Solo or group">
      {(['solo', 'group'] as const).map((v) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-body font-medium transition-colors ${value === v ? 'bg-surface-card text-content shadow-sm' : 'text-content-muted hover:text-content'}`}
        >
          {v === 'solo' ? <><User className="h-4 w-4" />Solo</> : <><Users className="h-4 w-4" />Group</>}
        </button>
      ))}
    </div>
  )
}
