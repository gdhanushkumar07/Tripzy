/**
 * Local data store with the subset of the Firestore API Tripzy uses.
 * Data lives in this browser (localStorage), keyed by document path, so the app
 * needs no cloud database. Sign-in still uses Firebase Auth; every path starts
 * with users/{uid}, so each account only ever sees its own data.
 */

type Data = Record<string, unknown>
type Store = Record<string, Data>

const KEY = 'tripzy:store:v1'
let cache: Store | null = null
const listeners = new Set<() => void>()

function load(): Store {
  if (cache) return cache
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') as Store } catch { cache = {} }
  return cache!
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache ?? {})) } catch { /* storage full or blocked: keep in memory */ }
  queueMicrotask(() => listeners.forEach((l) => l()))
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === KEY) { cache = null; listeners.forEach((l) => l()) } })
}

// ---------------------------------------------------------------- references

export type Firestore = { kind: 'local' }
export type DocumentData = Data
export type DocumentReference<T = DocumentData> = { kind: 'doc'; path: string; id: string; _t?: T }
export type CollectionReference = { kind: 'col'; path: string; id: string }
type Constraint =
  | { t: 'where'; field: string; op: string; value: unknown }
  | { t: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { t: 'limit'; n: number }
export type Query = { kind: 'query'; col: CollectionReference; cs: Constraint[] }

const join = (base: unknown, segs: string[]) => {
  const head = typeof base === 'string' ? base : typeof base === 'object' && base && 'path' in base ? (base as { path: string }).path : ''
  const parts = [head, ...segs].filter(Boolean)
  return parts.join('/')
}
export function doc(base: unknown, ...segs: string[]): DocumentReference {
  const path = join(base, segs)
  return { kind: 'doc', path, id: path.split('/').pop() || '' }
}
export function collection(base: unknown, ...segs: string[]): CollectionReference {
  const path = join(base, segs)
  return { kind: 'col', path, id: path.split('/').pop() || '' }
}
export const where = (field: string, op: string, value: unknown): Constraint => ({ t: 'where', field, op, value })
export const orderBy = (field: string, dir: 'asc' | 'desc' = 'asc'): Constraint => ({ t: 'orderBy', field, dir })
export const limit = (n: number): Constraint => ({ t: 'limit', n })
export function query(col: CollectionReference | Query, ...cs: Constraint[]): Query {
  return col.kind === 'query' ? { ...col, cs: [...col.cs, ...cs] } : { kind: 'query', col, cs }
}

// ---------------------------------------------------------------- snapshots

export class DocumentSnapshot<T = DocumentData> {
  constructor(public ref: DocumentReference, private d: Data | undefined) {}
  get id() { return this.ref.id }
  readonly metadata = { hasPendingWrites: false, fromCache: false }
  exists() { return this.d !== undefined }
  get(field: string): unknown { return this.d === undefined ? undefined : getField(this.d, field) }
  data(): T | undefined { return this.d === undefined ? undefined : (structuredClone(this.d) as T) }
}
export class QuerySnapshot<T = DocumentData> {
  constructor(public docs: DocumentSnapshot<T>[]) {}
  readonly metadata = { hasPendingWrites: false, fromCache: false }
  get empty() { return this.docs.length === 0 }
  get size() { return this.docs.length }
  forEach(fn: (d: DocumentSnapshot<T>) => void) { this.docs.forEach(fn) }
}

const getField = (d: Data, field: string): unknown => field.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Data)[k] : undefined), d)

function match(v: unknown, op: string, x: unknown): boolean {
  switch (op) {
    case '==': return v === x
    case '!=': return v !== x
    case '<': return (v as number) < (x as number)
    case '<=': return (v as number) <= (x as number)
    case '>': return (v as number) > (x as number)
    case '>=': return (v as number) >= (x as number)
    case 'in': return Array.isArray(x) && x.includes(v)
    case 'not-in': return Array.isArray(x) && !x.includes(v)
    case 'array-contains': return Array.isArray(v) && v.includes(x)
    case 'array-contains-any': return Array.isArray(v) && Array.isArray(x) && x.some((i) => v.includes(i))
    default: return false
  }
}

function runQuery(q: CollectionReference | Query): DocumentSnapshot[] {
  const col = q.kind === 'query' ? q.col : q
  const cs = q.kind === 'query' ? q.cs : []
  const prefix = col.path + '/'
  const st = load()
  let rows = Object.keys(st)
    .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
    .map((p) => ({ p, d: st[p] }))
  for (const c of cs) if (c.t === 'where') rows = rows.filter((r) => match(getField(r.d, c.field), c.op, c.value))
  for (const c of [...cs].reverse()) {
    if (c.t !== 'orderBy') continue
    rows.sort((a, b) => {
      const x = getField(a.d, c.field) as number | string, y = getField(b.d, c.field) as number | string
      const r = x === y ? 0 : x === undefined ? 1 : y === undefined ? -1 : x < y ? -1 : 1
      return c.dir === 'desc' ? -r : r
    })
  }
  const lim = cs.find((c) => c.t === 'limit') as { n: number } | undefined
  if (lim) rows = rows.slice(0, lim.n)
  return rows.map((r) => new DocumentSnapshot(doc(r.p), r.d))
}

// ---------------------------------------------------------------- sentinels

const SENTINEL = '__tzSentinel'
type Sentinel = { [SENTINEL]: 'delete' | 'union' | 'remove' | 'now' | 'inc'; v?: unknown[] | number }
export const deleteField = (): Sentinel => ({ [SENTINEL]: 'delete' })
export const arrayUnion = (...v: unknown[]): Sentinel => ({ [SENTINEL]: 'union', v })
export const arrayRemove = (...v: unknown[]): Sentinel => ({ [SENTINEL]: 'remove', v })
export const serverTimestamp = (): Sentinel => ({ [SENTINEL]: 'now' })
export const increment = (n: number): Sentinel => ({ [SENTINEL]: 'inc', v: n })
const isSentinel = (x: unknown): x is Sentinel => !!x && typeof x === 'object' && SENTINEL in (x as object)

function apply(prev: unknown, x: Sentinel): unknown {
  const arr = Array.isArray(prev) ? prev : []
  switch (x[SENTINEL]) {
    case 'union': return [...arr, ...(x.v as unknown[]).filter((i) => !arr.includes(i))]
    case 'remove': return arr.filter((i) => !(x.v as unknown[]).includes(i))
    case 'now': return Date.now()
    case 'inc': return (typeof prev === 'number' ? prev : 0) + (x.v as number)
    default: return undefined
  }
}

/** Resolve sentinels inside a plain value tree (setDoc payloads). */
function clean(v: unknown, prev?: unknown): unknown {
  if (isSentinel(v)) return apply(prev, v)
  if (Array.isArray(v)) return v.map((i) => clean(i))
  if (v && typeof v === 'object') {
    const out: Data = {}
    for (const [k, val] of Object.entries(v as Data)) {
      if (val === undefined) continue
      if (isSentinel(val) && val[SENTINEL] === 'delete') continue
      out[k] = clean(val, prev && typeof prev === 'object' ? (prev as Data)[k] : undefined)
    }
    return out
  }
  return v
}

function deepMerge(base: Data, patch: Data): Data {
  const out: Data = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (isSentinel(v)) {
      if (v[SENTINEL] === 'delete') delete out[k]
      else out[k] = apply(out[k], v)
    } else if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as Data, v as Data)
    } else out[k] = clean(v)
  }
  return out
}

// ---------------------------------------------------------------- reads and writes

export async function getDoc<T = DocumentData>(ref: DocumentReference): Promise<DocumentSnapshot<T>> {
  return new DocumentSnapshot<T>(ref, load()[ref.path])
}
export async function getDocs<T = DocumentData>(q: CollectionReference | Query): Promise<QuerySnapshot<T>> {
  return new QuerySnapshot<T>(runQuery(q) as DocumentSnapshot<T>[])
}
export async function getCountFromServer(q: CollectionReference | Query) {
  const n = runQuery(q).length
  return { data: () => ({ count: n }) }
}
export async function setDoc(ref: DocumentReference, data: Data, opts?: { merge?: boolean }): Promise<void> {
  const st = load()
  st[ref.path] = opts?.merge && st[ref.path] ? deepMerge(st[ref.path], data) : (clean(data) as Data)
  save()
}
export async function addDoc(col: CollectionReference, data: Data): Promise<DocumentReference> {
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  const ref = doc(col, id)
  await setDoc(ref, data)
  return ref
}
export async function updateDoc(ref: DocumentReference, patch: Data): Promise<void> {
  const st = load()
  if (!st[ref.path]) throw Object.assign(new Error('No document to update'), { code: 'not-found' })
  const d: Data = structuredClone(st[ref.path])
  for (const [key, v] of Object.entries(patch)) {
    const parts = key.split('.')
    let o: Data = d
    for (const k of parts.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k] as Data }
    const last = parts[parts.length - 1]
    if (isSentinel(v)) { if (v[SENTINEL] === 'delete') delete o[last]; else o[last] = apply(o[last], v) }
    else o[last] = clean(v)
  }
  st[ref.path] = d
  save()
}
export async function deleteDoc(ref: DocumentReference): Promise<void> {
  const st = load()
  delete st[ref.path]
  save()
}

/** Live updates for a document or a query; the first callback fires immediately. */
type SnapOpts = { includeMetadataChanges?: boolean }
export function onSnapshot<T = DocumentData>(ref: DocumentReference, next: (s: DocumentSnapshot<T>) => void, error?: (e: Error) => void): () => void
export function onSnapshot<T = DocumentData>(ref: DocumentReference, opts: SnapOpts, next: (s: DocumentSnapshot<T>) => void, error?: (e: Error) => void): () => void
export function onSnapshot<T = DocumentData>(q: CollectionReference | Query, next: (s: QuerySnapshot<T>) => void, error?: (e: Error) => void): () => void
export function onSnapshot<T = DocumentData>(q: CollectionReference | Query, opts: SnapOpts, next: (s: QuerySnapshot<T>) => void, error?: (e: Error) => void): () => void
export function onSnapshot(target: DocumentReference | CollectionReference | Query, ...args: unknown[]): () => void {
  const next = (typeof args[0] === 'function' ? args[0] : args[1]) as (s: unknown) => void
  const emit = () => {
    if (target.kind === 'doc') next(new DocumentSnapshot(target, load()[target.path]))
    else next(new QuerySnapshot(runQuery(target)))
  }
  listeners.add(emit)
  queueMicrotask(emit)
  return () => { listeners.delete(emit) }
}

// ---------------------------------------------------------------- setup no-ops (API compatibility)

export const initializeFirestore = (): Firestore => ({ kind: 'local' })
export const getFirestore = (): Firestore => ({ kind: 'local' })
export const persistentLocalCache = () => ({})
export const persistentMultipleTabManager = () => ({})
export const connectFirestoreEmulator = () => undefined
