import {
  arrayRemove, arrayUnion, deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc,
  type DocumentReference,
} from './localstore'
import { db } from './firebase'
import { request } from './request'
import type { Prefs } from './types'

/**
 * Write through Firestore without blocking the UI when offline: the SDK keeps
 * the write in its offline queue and syncs on reconnect. Online writes go
 * through request() so they time out, retry and fail with a clear message.
 */
export async function write(op: () => Promise<unknown>, key?: string): Promise<'saved' | 'local'> {
  if (!navigator.onLine) {
    op().catch(() => undefined)
    return 'local'
  }
  await request(op, { key, timeoutMs: 8000 })
  return 'saved'
}

export const userDoc = (uid: string) => doc(db, 'users', uid)
export const routeDoc = (uid: string, id: string) => doc(db, 'users', uid, 'routes', id)
export const tripDoc = (uid: string, id: string) => doc(db, 'users', uid, 'trips', id)
export const groupDoc = (code: string) => doc(db, 'groups', code)

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function savePrefs(uid: string, name: string, prefs: Prefs) {
  return write(() => setDoc(userDoc(uid), { name, prefs }, { merge: true }), `prefs:${uid}`)
}

export const removeDoc = (ref: DocumentReference) => write(() => deleteDoc(ref), `del:${ref.path}`)

// ---------------------------------------------------------------- groups

export type GroupType = 'commute' | 'tour'
export type Member = { name: string; destination?: string; answers?: Record<string, unknown>; ready: boolean; dest?: { name: string; lat: number; lon: number }; origin?: { name: string; lat: number; lon: number } }
export type Group<R = unknown> = {
  type: GroupType; ownerUid: string; memberUids: string[]; members: Record<string, Member>
  settings?: Record<string, unknown>; result?: R | null; createdAt: number; updatedAt: number
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/

export function newCode(): string {
  return Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')
}

export async function createGroup(type: GroupType, uid: string, name: string, settings: Record<string, unknown> = {}): Promise<string> {
  const code = newCode()
  const g: Group = {
    type, ownerUid: uid, memberUids: [uid], members: { [uid]: { name, ready: false } },
    settings, result: null, createdAt: Date.now(), updatedAt: Date.now(),
  }
  await request(() => setDoc(groupDoc(code), g), { key: `group:create:${uid}` })
  return code
}

/** A signed-in user may add only themselves. Non-members cannot read the group, so join is a blind update. */
export async function joinGroup(code: string, uid: string, name: string): Promise<Group> {
  // Already a member (e.g. reopening the link)? Then just return the group.
  const mine = await getDoc(groupDoc(code)).then((s) => s.data() as Group | undefined, () => undefined)
  if (mine?.memberUids.includes(uid)) return mine
  await request(
    () => updateDoc(groupDoc(code), { memberUids: arrayUnion(uid), [`members.${uid}`]: { name, ready: false }, updatedAt: Date.now() }),
    { key: `group:join:${code}` },
  )
  const snap = await request(() => getDoc(groupDoc(code)))
  return snap.data() as Group
}

export const updateMember = (code: string, uid: string, patch: Partial<Member>) =>
  write(() => updateDoc(groupDoc(code), {
    ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`members.${uid}.${k}`, v])),
    updatedAt: Date.now(),
  }))

export const removeMember = (code: string, uid: string) =>
  write(() => updateDoc(groupDoc(code), { memberUids: arrayRemove(uid), [`members.${uid}`]: deleteField(), updatedAt: Date.now() }))

export const setGroup = (code: string, patch: Record<string, unknown>) =>
  write(() => updateDoc(groupDoc(code), { ...patch, updatedAt: Date.now() }), `group:set:${code}`)
