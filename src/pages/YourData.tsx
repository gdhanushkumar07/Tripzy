/**
 * "Your data": exactly what Tripzy stores for this account, where, and controls to export or
 * delete it. Everything lives in Firestore under users/{uid} (readable only by this user, see
 * firestore.rules) and is cached on this device for offline use.
 */
import { collection, deleteDoc, getCountFromServer, getDocs, limit, query } from 'firebase/firestore'
import { Database, Download, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { db } from '../lib/firebase'
import { useAction, useStatus } from '../lib/status'

const PARTS = [
  { col: 'routes', label: 'Saved routes', what: 'From, to, time, modes and the summary of routes you saved' },
  { col: 'trips', label: 'Trips', what: 'Itineraries from the Tourist Planner and Tripzy AI' },
  { col: 'chats', label: 'Tripzy AI chats', what: 'Your messages, the answers, and what each chat was planning' },
  { col: 'drafts', label: 'Forms in progress', what: 'Daily Traveller and Tourist Planner answers, so a reload resumes where you were' },
  { col: 'history', label: 'Activity history', what: 'Searches, saved routes and trips — used only to personalise your suggestions' },
] as const

export function YourData() {
  const { user, profile } = useAuth()
  const { toast } = useStatus()
  const uid = user!.uid
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  useEffect(() => {
    for (const p of PARTS) getCountFromServer(collection(db, 'users', uid, p.col)).then((c) => setCounts((x) => ({ ...x, [p.col]: c.data().count })), () => setCounts((x) => ({ ...x, [p.col]: null })))
  }, [uid])

  const exportAll = useAction(async () => {
    const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), account: { uid, email: user!.email, name: profile.name }, profile: profile.prefs }
    for (const p of PARTS) out[p.col] = (await getDocs(query(collection(db, 'users', uid, p.col), limit(2000)))).docs.map((d) => ({ id: d.id, ...d.data() }))
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url; a.download = `tripzy-data-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  })
  const wipe = useAction(async (col: string) => {
    const docs = (await getDocs(query(collection(db, 'users', uid, col), limit(500)))).docs
    await Promise.all(docs.map((d) => deleteDoc(d.ref)))
    setCounts((x) => ({ ...x, [col]: 0 }))
    toast(`Deleted ${docs.length} item${docs.length === 1 ? '' : 's'}`, 'success')
  })

  return (
    <div data-reveal className="mt-8 space-y-4">
      <p className="text-[14px] text-content-muted">
        <Database className="me-1 inline h-4 w-4" />Stored in your account (Firestore, <code>users/{'{'}your id{'}'}</code>), readable only by you, and cached on this device so the app works offline. Signed in as <strong>{user!.email ?? profile.name}</strong>.
      </p>
      <ul className="divide-y divide-[var(--border)] rounded-2xl border border-edge">
        <li className="flex flex-wrap items-center gap-3 p-3">
          <div className="min-w-0 flex-1"><p className="font-semibold text-content">Profile and preferences</p><p className="text-caption text-content-muted">Name, comfortable modes, family, vehicles, luggage, priority{profile.prefs.asked ? ` · confirmed ${new Date(profile.prefs.asked).toLocaleDateString()}` : ''}</p></div>
          <span className="text-caption text-content-muted">1 record</span>
        </li>
        {PARTS.map((p) => (
          <li key={p.col} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1"><p className="font-semibold text-content">{p.label}</p><p className="text-caption text-content-muted">{p.what}</p></div>
            <span className="text-caption text-content-muted">{counts[p.col] == null ? '…' : `${counts[p.col]} item${counts[p.col] === 1 ? '' : 's'}`}</span>
            {(p.col === 'chats' || p.col === 'history') && !!counts[p.col] && (
              <button type="button" className="btn-secondary btn-sm" disabled={wipe.busy} onClick={() => { if (window.confirm(`Delete all ${p.label.toLowerCase()}? This cannot be undone.`)) void wipe.run(p.col) }}><Trash2 className="h-3.5 w-3.5" />Delete all</button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="btn-secondary" onClick={() => void exportAll.run()} disabled={exportAll.busy}><Download className="h-4 w-4" />{exportAll.busy ? 'Preparing…' : 'Download all my data (JSON)'}</button>
    </div>
  )
}
