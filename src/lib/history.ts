/**
 * Personalisation from the user's own history (users/{uid}/history). Pure algorithm,
 * no AI: interest boosts and preferred modes with a plain-language reason for each.
 */
import { addDoc, collection, limit, onSnapshot, orderBy, query } from './localstore'
import { useEffect, useState } from 'react'
import { db } from './firebase'

import { profileFrom, type HistoryEvent, type TasteProfile } from './taste'
export { profileFrom, type HistoryEvent, type TasteProfile }

export function logEvent(uid: string, e: HistoryEvent) {
  addDoc(collection(db, 'users', uid, 'history'), e).catch(() => undefined) // offline: queued by Firestore
}

export function useTaste(uid: string | undefined): TasteProfile | null {
  const [p, setP] = useState<TasteProfile | null>(null)
  useEffect(() => {
    if (!uid) return
    return onSnapshot(
      query(collection(db, 'users', uid, 'history'), orderBy('at', 'desc'), limit(300)),
      (s) => setP(profileFrom(s.docs.map((d) => d.data() as HistoryEvent))),
      () => setP(profileFrom([])),
    )
  }, [uid])
  return p
}
