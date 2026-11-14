import { onSnapshot } from 'firebase/firestore'
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
    <section className="card space-y-3" aria-label="Group">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-600">
          Group code <strong className="font-mono text-base text-slate-900">{code}</strong>
        </p>
        <button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void copy()}>Share invite link</button>
        <span className="text-xs text-slate-500 break-all">{link}</span>
      </div>
      {!group ? (
        <div className="h-10 animate-pulse rounded-lg bg-slate-200" />
      ) : (
        <ul className="divide-y divide-slate-100" aria-label="Members">
          {group.memberUids.map((uid) => {
            const m = group.members[uid]
            if (!m) return null
            return (
              <li key={uid} className="flex items-center gap-2 py-2 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${m.ready ? 'bg-brand-600' : 'bg-slate-300'}`} aria-hidden />
                <span className="font-medium">{m.name}{uid === user?.uid ? ' (you)' : ''}{uid === group.ownerUid ? ' · organiser' : ''}</span>
                <span className="text-slate-500">{m.ready ? (type === 'commute' ? 'destination set' : 'answers in') : 'waiting…'}</span>
                {isOwner && uid !== user?.uid && (
                  <button className="ml-auto text-xs font-semibold text-red-700 underline" onClick={() => void remove(uid, m.name)}>
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
    <div className="inline-flex rounded-xl bg-slate-200 p-1" role="radiogroup" aria-label="Solo or group">
      {(['solo', 'group'] as const).map((v) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${value === v ? 'bg-white shadow-sm' : 'text-slate-600'}`}
        >
          {v === 'solo' ? '🧍 Solo' : '👥 Group'}
        </button>
      ))}
    </div>
  )
}
