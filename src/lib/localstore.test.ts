import { beforeAll, describe, expect, it } from 'vitest'

// minimal in-memory localStorage for the node test environment
const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
}
let ls: typeof import('./localstore')
beforeAll(async () => { ls = await import('./localstore') })

const db = { kind: 'local' }
const api = () => ls

describe('localstore', () => {
  it('queries return documents with their ids', async () => {
    await api().setDoc(api().doc(db, 'users', 'u1', 'chats', 'a'), { updatedAt: 1, t: 'x' })
    await api().setDoc(api().doc(db, 'users', 'u1', 'chats', 'b'), { updatedAt: 2, t: 'y' })
    await api().setDoc(api().doc(db, 'users', 'u2', 'chats', 'c'), { updatedAt: 3, t: 'z' })
    const s = await api().getDocs(api().query(api().collection(db, 'users', 'u1', 'chats'), api().orderBy('updatedAt', 'desc'), api().limit(5)))
    expect(s.docs.map((d) => d.id)).toEqual(['b', 'a'])
    expect((await api().getDocs(api().query(api().collection(db, 'users', 'u1', 'chats'), api().where('t', '==', 'x')))).docs.map((d) => d.id)).toEqual(['a'])
  })
  it('merges, dotted updates and sentinels', async () => {
    const r = api().doc(db, 'groups', 'G1')
    await api().setDoc(r, { memberUids: ['u1'], members: { u1: { ready: false } } })
    await api().updateDoc(r, { memberUids: api().arrayUnion('u2'), 'members.u2': { ready: true }, 'members.u1': api().deleteField() })
    expect((await api().getDoc(r)).data()).toEqual({ memberUids: ['u1', 'u2'], members: { u2: { ready: true } } })
  })
  it('live listeners fire with ids', async () => {
    const ids = await new Promise<string[]>((res) => {
      const off = api().onSnapshot(api().collection(db, 'users', 'u1', 'chats'), (s) => { off(); res(s.docs.map((d) => d.id).sort()) })
    })
    expect(ids).toEqual(['a', 'b'])
  })
})
