/**
 * Tripzy AI — ChatGPT-style, in the Tripzy look. The chat does the app's work:
 *  - every trip it plans fills Daily Traveller (same form, same results), every tour fills the
 *    Tourist Planner and creates the itinerary; "Your plan" on the right shows what is set and
 *    edits it with one tap ("Cheaper", "Avoid buses", "Leave later"…)
 *  - preferences are asked once with a picker inside the chat and saved to the profile
 *  - follow-ups edit the current plan; several chats, synced to the account; voice in, voice out
 */
import { collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, setDoc } from '../lib/localstore'
import { BedDouble, Check, CloudSun, ExternalLink, LocateFixed, Menu, Mic, MicOff, Minus, Plus, Send, Sparkles, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { fmtDur } from '../commute/engine'
import { api, type GeoPoint } from '../lib/api'
import { useAuth } from '../lib/auth'
import { newId, savePrefs, tripDoc, write } from '../lib/db'
import { db } from '../lib/firebase'
import { currentPosition } from '../lib/location'
import { ErrorBox, useAction, useStatus } from '../lib/status'
import { MODES, MODE_ICON, MODE_LABEL, type Family, type Mode, type Prefs, type Priority } from '../lib/types'
import { writeDraft } from '../lib/useDraft'
import type { Trip } from '../tour/generate'
import { mergeAnswers, type Answers } from '../tour/questions'

type RouteReq = { from?: string; to: string; time?: string; date?: string; priority?: Priority; avoid?: string[]; luggage?: 'light' | 'heavy'; people?: number }
type RouteCard = { type: 'routes'; title: string; url: string; journey: boolean; options: { labels: string[]; minutes: number; fare: number; perPerson: boolean; summary: string }[]; note?: string; request?: RouteReq }
type HotelCard = { type: 'hotels'; title: string; items: { name: string; price?: number; rating?: number; url?: string; km: number }[]; note?: string }
type WeatherCard = { type: 'weather'; title: string; days: { date: string; max: number; min: number; rain: number; summary: string }[] }
type PrefsCard = { type: 'prefs'; reason: string }
type TourAnswers = Answers & { place?: { name: string; lat: number; lon: number; state?: string } }
type TourCard = { type: 'tour'; title: string; answers: TourAnswers; missing: string[]; ready: boolean }
type Card = RouteCard | HotelCard | WeatherCard | PrefsCard | TourCard
type Action = { type: 'commute'; url: string; params: Record<string, string>; journey: boolean } | { type: 'tour'; answers: TourAnswers; create: boolean }
type ChatState = { route?: RouteReq; tour?: Record<string, unknown>; pending?: RouteReq; tripId?: string; commuteUrl?: string }
type Msg = { role: 'user' | 'assistant'; text: string; at: number; cards?: Card[]; engine?: string; sources?: string[]; tripId?: string }
type Chat = { id: string; title: string; messages: Msg[]; state?: ChatState; createdAt: number; updatedAt: number }
type Reply = { reply: string; cards: Card[]; actions: Action[]; state: ChatState; engine: string; sources: string[] }

const EXAMPLES = [
  'Take me from Kokapet to Miyapur.',
  "I have a scooty but don't want to drive in traffic. Karmanghat to Kokapet",
  'Kokapet to Warangal tomorrow at 7 — I hate traffic and pollution',
  '3 days in Jaipur from next Friday with my parents, vegetarian',
  'Hotels in Varanasi',
  'How does the group meeting point work?',
]
const QUICK_EDITS = ['Make it cheaper', 'I am in a hurry', 'More comfortable', 'Use the metro', 'Avoid buses', 'I have heavy bags', 'Leave 1 hour later']
const LABEL_STYLE: Record<string, string> = {
  Recommended: 'bg-accent text-accent-text', 'Best balanced': 'bg-accent text-accent-text', Fastest: 'bg-accent-subtle text-accent-on', Cheapest: 'bg-success-soft text-success',
  'Most comfortable': 'tz-coral-pill', 'Public transport': 'bg-surface-secondary text-content-secondary', 'Least traffic & pollution': 'bg-[#dcfce7] text-[#14532d]', 'Via metro': 'bg-[#dbeafe] text-[#1e3a8a]',
}
const chatsCol = (uid: string) => collection(db, 'users', uid, 'chats')
const plain = (s: string) => s.replace(/\*\*/g, '').replace(/\/commute\?\S+/g, '')

// ---------------------------------------------------------------- voice

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void }
function useSpeech(onText: (t: string) => void) {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  const [on, setOn] = useState(false)
  const rec = useRef<Recognition | null>(null)
  const toggle = () => {
    if (!Ctor) return
    if (on) { rec.current?.stop(); return }
    const r = new Ctor()
    r.lang = navigator.language || 'en-IN'
    r.interimResults = false
    r.onresult = (e) => onText(Array.from(e.results).map((x) => x[0].transcript).join(' '))
    r.onend = () => setOn(false)
    r.onerror = () => setOn(false)
    rec.current = r
    r.start()
    setOn(true)
  }
  return { supported: !!Ctor, on, toggle }
}

// ---------------------------------------------------------------- message content

function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const parts: ReactNode[] = []
        const re = /\*\*(.+?)\*\*|(\/commute\?[^\s)]+)|(https?:\/\/[^\s)]+)/g
        let last = 0, m: RegExpExecArray | null, k = 0
        while ((m = re.exec(line))) {
          if (m.index > last) parts.push(line.slice(last, m.index))
          if (m[1]) parts.push(<strong key={k++}>{m[1]}</strong>)
          else if (m[2]) parts.push(<Link key={k++} to={m[2]} className="btn-link">open in Daily Traveller</Link>)
          else parts.push(<a key={k++} href={m[3]} target="_blank" rel="noreferrer" className="btn-link">{new URL(m[3]).host}</a>)
          last = m.index + m[0].length
        }
        if (last < line.length) parts.push(line.slice(last))
        return <p key={i} className="leading-relaxed">{parts}</p>
      })}
    </>
  )
}

function RouteView({ c }: { c: RouteCard }) {
  return (
    <div className="mt-2 rounded-2xl border border-edge bg-surface-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-content">{c.title}</p>
        <Link to={c.url} className="btn-secondary btn-sm"><ExternalLink className="h-3.5 w-3.5" />Map, legs and booking</Link>
      </div>
      {c.note && <p className="mt-1 text-caption text-warning">{c.note}</p>}
      <ul className="mt-2 space-y-2">
        {c.options.map((o, i) => (
          <li key={i} className="text-body">
            <div className="flex flex-wrap items-center gap-1.5">
              {o.labels.map((l) => <span key={l} className={`rounded-full px-2 py-0.5 text-xs font-bold ${LABEL_STYLE[l] ?? 'bg-surface-secondary'}`}>{l}</span>)}
              <strong className="text-content">{fmtDur(o.minutes)}</strong>
              <span className="text-content-muted">· ₹{o.fare.toLocaleString('en-IN')}{o.perPerson ? ' per person' : ' total'}</span>
            </div>
            <p className="text-caption text-content-muted">{o.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CardView({ c, onPrefs, tripId, creating }: { c: Card; onPrefs: () => ReactNode; tripId?: string; creating?: boolean }) {
  if (c.type === 'routes') return <RouteView c={c} />
  if (c.type === 'prefs') return <>{onPrefs()}</>
  if (c.type === 'tour') return (
    <div className="mt-2 rounded-2xl border border-edge bg-surface-card p-3">
      <p className="font-semibold text-content">{c.title}</p>
      <p className="text-caption text-content-muted">
        {[c.answers.start, c.answers.party, c.answers.diet ? (c.answers.diet === 2 ? 'pure veg' : 'vegetarian') : '', c.answers.pace === 1 ? 'relaxed' : c.answers.pace === 3 ? 'packed' : 'balanced', c.answers.interests?.join(', ')].filter(Boolean).join(' · ')}
      </p>
      {!c.ready && <p className="mt-1 text-caption text-warning">Still needed: {c.missing.join(', ')}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {tripId ? <Link className="btn btn-sm" to={`/tour/${tripId}`}>Open the itinerary</Link> : c.ready && creating ? <span className="text-caption text-content-muted">Creating the itinerary…</span> : null}
        <Link className="btn-secondary btn-sm" to="/tour">Open Tourist Planner (filled in)</Link>
      </div>
    </div>
  )
  if (c.type === 'hotels') return (
    <div className="mt-2 rounded-2xl border border-edge bg-surface-card p-3">
      <p className="font-semibold text-content"><BedDouble className="me-1 inline h-4 w-4" />{c.title}</p>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {c.items.map((h) => (
          <li key={h.name} className="text-body">
            {h.url ? <a href={h.url} target="_blank" rel="noreferrer" className="btn-link">{h.name}</a> : h.name}
            <span className="text-caption text-content-muted"> · {h.price ? `₹${h.price.toLocaleString('en-IN')}/night · ` : ''}{h.rating ? `${h.rating}/10 · ` : ''}{h.km} km</span>
          </li>
        ))}
      </ul>
      {c.note && <p className="mt-1 text-caption text-content-faint">{c.note}</p>}
    </div>
  )
  return (
    <div className="mt-2 rounded-2xl border border-edge bg-surface-card p-3">
      <p className="font-semibold text-content"><CloudSun className="me-1 inline h-4 w-4" />{c.title}</p>
      <ul className="mt-1 flex flex-wrap gap-2 text-caption">
        {c.days.map((d) => <li key={d.date} className="rounded-xl bg-surface-secondary px-2 py-1">{d.date.slice(5)} · {d.min}–{d.max}° · {d.rain}% rain · {d.summary}</li>)}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------- preference picker (asked once, in the chat)

function PrefsPicker({ prefs, onSave, busy }: { prefs: Prefs; onSave: (p: Prefs, summary: string) => void; busy: boolean }) {
  const [modes, setModes] = useState<Mode[]>(prefs.modes)
  const [luggage, setLuggage] = useState<'light' | 'heavy'>(prefs.luggage ?? 'light')
  const [own, setOwn] = useState<'none' | 'car' | 'scooter' | 'both'>(prefs.vehicles?.car && prefs.vehicles?.scooter ? 'both' : prefs.vehicles?.car ? 'car' : prefs.vehicles?.scooter ? 'scooter' : 'none')
  const [fam, setFam] = useState<Family>(prefs.family ?? { adults: 1, children: 0, seniors: 0 })
  const [priority, setPriority] = useState<Priority>(prefs.priority ?? 'balanced')
  const chip = (on: boolean, label: ReactNode, click: () => void, key: string) => <button key={key} type="button" aria-pressed={on} className={`chip ${on ? 'chip-on' : 'chip-off'}`} onClick={click}>{label}</button>
  const step = (k: keyof Family, d: number) => setFam({ ...fam, [k]: Math.max(k === 'adults' ? (fam.seniors ? 0 : 1) : 0, Math.min(9, fam[k] + d)) })
  const save = () => {
    const vehicles = { ...(own === 'car' || own === 'both' ? { car: prefs.vehicles?.car ?? { kmpl: 15, fuel: 'petrol' as const, seats: 5 } } : {}), ...(own === 'scooter' || own === 'both' ? { scooter: prefs.vehicles?.scooter ?? { kmpl: 45 } } : {}) }
    const next: Prefs = { ...prefs, modes: modes.length ? modes : prefs.modes, luggage, vehicles, family: fam, priority, asked: Date.now() }
    onSave(next, `My preferences: comfortable with ${next.modes.map((m) => MODE_LABEL[m].toLowerCase()).join(', ')}; ${luggage} luggage; vehicle: ${own === 'none' ? 'none' : own}; ${fam.adults} adult${fam.adults === 1 ? '' : 's'}${fam.children ? `, ${fam.children} children` : ''}${fam.seniors ? `, ${fam.seniors} seniors` : ''}; priority ${priority}.`)
  }
  return (
    <div className="mt-2 space-y-4 rounded-2xl border border-[var(--accent)] bg-surface-card p-4">
      <div>
        <p className="label">Modes you're comfortable with</p>
        <div className="flex flex-wrap gap-1.5">{MODES.map((m) => chip(modes.includes(m), <><span aria-hidden>{MODE_ICON[m]}</span>{MODE_LABEL[m]}</>, () => setModes(modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m]), m))}</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="label">Usually travelling</p>
          {(['adults', 'children', 'seniors'] as const).map((k) => (
            <div key={k} className="flex items-center gap-2 py-0.5">
              <button type="button" className="btn-secondary btn-sm !h-8 !w-8 !p-0" aria-label={`Fewer ${k}`} onClick={() => step(k, -1)}><Minus className="h-3.5 w-3.5" /></button>
              <span className="min-w-[6rem] text-center text-body"><strong>{fam[k]}</strong> {k}</span>
              <button type="button" className="btn-secondary btn-sm !h-8 !w-8 !p-0" aria-label={`More ${k}`} onClick={() => step(k, 1)}><Plus className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div><p className="label">Luggage</p><div className="flex flex-wrap gap-1.5">{chip(luggage === 'light', 'Light bags', () => setLuggage('light'), 'l')}{chip(luggage === 'heavy', 'Heavy bags', () => setLuggage('heavy'), 'h')}</div></div>
          <div><p className="label">Your own vehicle</p><div className="flex flex-wrap gap-1.5">{(['none', 'car', 'scooter', 'both'] as const).map((v) => chip(own === v, v === 'none' ? 'None' : v === 'both' ? 'Car + scooter' : v === 'car' ? '🚗 Car' : '🛵 Scooter', () => setOwn(v), v))}</div></div>
          <div><p className="label">What matters most</p><div className="flex flex-wrap gap-1.5">{([['balanced', 'Balance'], ['fastest', 'Time'], ['cheapest', 'Money'], ['comfort', 'Comfort']] as const).map(([v, l]) => chip(priority === v, l, () => setPriority(v), v))}</div></div>
        </div>
      </div>
      <button type="button" className="btn" onClick={save} disabled={busy}><Check className="h-4 w-4" />Save and continue</button>
      <p className="text-caption text-content-faint">Saved to your profile — Daily Traveller, the Tourist Planner and Tripzy AI all use it. Change it any time in the dashboard or by saying "change my preferences".</p>
    </div>
  )
}

// ---------------------------------------------------------------- page

export default function AiPage() {
  const { user, profile } = useAuth()
  const { toast } = useStatus()
  const { chatId } = useParams()
  const navigate = useNavigate()
  const [chats, setChats] = useState<Chat[]>([])
  const [draft, setDraft] = useState('')
  const [here, setHere] = useState<GeoPoint | null>(null)
  const [locMsg, setLocMsg] = useState('')
  const [memory, setMemory] = useState<{ title: string; text: string }[]>([])
  const [side, setSide] = useState(false)
  const [speak, setSpeak] = useState(() => { try { return localStorage.getItem('tripzy:ai:speak') === '1' } catch { return false } })
  const [creating, setCreating] = useState(false)
  const [prefsOverride, setPrefsOverride] = useState<Prefs | null>(null)
  const prefs = prefsOverride ?? profile.prefs
  const endRef = useRef<HTMLDivElement>(null)
  const uid = user?.uid

  useEffect(() => {
    if (!uid) return
    return onSnapshot(query(chatsCol(uid), orderBy('updatedAt', 'desc'), limit(50)), (s) => setChats(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Chat, 'id'>) }))))
  }, [uid])

  // personal memory for retrieval: saved routes and trips
  useEffect(() => {
    if (!uid) return
    void Promise.all([
      getDocs(query(collection(db, 'users', uid, 'routes'), orderBy('createdAt', 'desc'), limit(20))).catch(() => null),
      getDocs(query(collection(db, 'users', uid, 'trips'), orderBy('updatedAt', 'desc'), limit(20))).catch(() => null),
    ]).then(([r, t]) => setMemory([
      ...(r?.docs ?? []).map((d) => ({ title: `Saved route: ${d.get('title') ?? ''}`, text: `${d.get('title') ?? ''} at ${d.get('time') ?? ''}. ${d.get('summary') ?? ''}` })),
      ...(t?.docs ?? []).map((d) => ({ title: `Saved trip: ${d.get('title') ?? ''}`, text: `${d.get('title') ?? ''} from ${d.get('start') ?? ''}` })),
    ]))
  }, [uid])

  const locate = () => { setLocMsg(''); currentPosition().then(setHere, (e: Error) => setLocMsg(e.message)) }
  useEffect(() => { void navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((p) => { if (p.state === 'granted') locate() }).catch(() => undefined) }, [])

  const active = useMemo(() => chats.find((c) => c.id === chatId) ?? null, [chats, chatId])
  const [pending, setPending] = useState<Msg[]>([])
  const saved = active?.messages ?? []
  const messages = [...saved, ...pending.filter((p) => !saved.some((m) => m.at === p.at))]
  const state: ChatState = active?.state ?? {}
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages.length])

  const saveChat = (id: string, base: Chat, msgs: Msg[], st: ChatState) =>
    write(() => setDoc(doc(db, 'users', uid!, 'chats', id), { title: base.title, createdAt: base.createdAt, updatedAt: Date.now(), messages: msgs.slice(-60), state: st }), `chat:${id}:${Date.now()}`)

  /** Do what the assistant decided in the app itself: fill Daily Traveller / Tourist Planner, create the itinerary. */
  const applyActions = async (actions: Action[], st: ChatState): Promise<{ state: ChatState; tripId?: string }> => {
    let next = { ...st }, tripId: string | undefined
    for (const a of actions) {
      if (a.type === 'commute') {
        const [fl, tl] = [a.params.fl, a.params.tl].map((v) => v.split(',').map(Number))
        await writeDraft(uid!, 'commute', {
          from: { name: a.params.f, lat: fl[0], lon: fl[1] }, to: { name: a.params.t, lat: tl[0], lon: tl[1] }, date: a.params.d, time: a.params.tm,
          modes: a.params.m.split(',').filter(Boolean), budget: '', maxTransfers: '', people: Number(a.params.p ?? 1) || 1, touched: true, groupCode: null,
          lastSearch: new URLSearchParams(a.params).toString(),
          ...(a.journey ? { ask: { party: { adults: +a.params.pa.split('.')[0], children: +a.params.pa.split('.')[1], seniors: +a.params.pa.split('.')[2] }, luggage: a.params.lg, priority: a.params.pr, own: a.params.ow } } : {}),
        })
        next = { ...next, commuteUrl: a.url }
      }
      if (a.type === 'tour') {
        await writeDraft(uid!, 'tour', { answers: a.answers, groupCode: null, doneTripId: null })
        if (a.create && a.answers.place) {
          setCreating(true)
          try {
            const merged = mergeAnswers(a.answers, [{ name: profile.name, answers: a.answers }])
            const fam = prefs.family
            const size = a.answers.party === 'solo' ? 1 : a.answers.party === 'couple' ? 2 : Math.max(2, fam ? fam.adults + fam.children + fam.seniors : 2)
            const trip = await api.post<Trip>('/api/tour/plan', { answers: merged, groupSize: size, place: a.answers.place }, `ai-tour:${JSON.stringify(merged)}`)
            tripId = newId()
            await write(() => setDoc(tripDoc(uid!, tripId!), trip), `trip:${tripId}`)
            await writeDraft(uid!, 'tour', { answers: a.answers, groupCode: null, doneTripId: tripId })
            next = { ...next, tripId }
          } catch (e) { toast(`Could not create the itinerary: ${(e as Error).message}`, 'error') } finally { setCreating(false) }
        }
      }
    }
    return { state: next, tripId }
  }

  const send = useAction(async (text: string, prefsNow?: Prefs) => {
    if (!uid || !text.trim()) return
    const id = chatId ?? newId()
    const userMsg: Msg = { role: 'user', text: text.trim(), at: Date.now() }
    const history = [...saved, userMsg]
    const base: Chat = active ?? { id, title: text.trim().slice(0, 60), messages: [], createdAt: Date.now(), updatedAt: Date.now() }
    setPending([userMsg]); setDraft('')
    if (!chatId) navigate(`/ai/${id}`, { replace: true })
    await saveChat(id, base, history, state)
    const p = prefsNow ?? prefs
    const r = await api.post<Reply>('/api/ai/chat', {
      messages: history.map((m) => ({ role: m.role, text: m.text })), state,
      context: { location: here ? { lat: here.lat, lon: here.lon, name: here.name } : undefined, prefs: p, prefsKnown: !!p.asked, memory, name: profile.name },
    }, `ai:${id}:${userMsg.at}`)
    const applied = await applyActions(r.actions ?? [], { ...state, ...r.state })
    const reply: Msg = { role: 'assistant', text: r.reply || 'Done.', at: Date.now(), cards: r.cards, engine: r.engine, sources: r.sources, ...(applied.tripId ? { tripId: applied.tripId } : {}) }
    setPending([userMsg, reply])
    await saveChat(id, base, [...history, reply], applied.state)
    setPending([])
    if (speak && 'speechSynthesis' in window) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(plain(reply.text).slice(0, 600))) }
  })

  const savePicked = async (next: Prefs, summary: string) => {
    if (!uid) return
    setPrefsOverride(next)
    const res = await savePrefs(uid, profile.name, next)
    toast(res === 'local' ? 'Preferences saved on this device — will sync when online' : 'Preferences saved to your profile', 'success')
    void send.run(summary, next)
  }

  const speech = useSpeech((t) => { setDraft(t); void send.run(t) })
  const submit = (e: FormEvent) => { e.preventDefault(); if (!send.busy) void send.run(draft) }
  const remove = async (id: string) => { if (!uid) return; await deleteDoc(doc(db, 'users', uid, 'chats', id)); if (id === chatId) navigate('/ai') }
  const lastRoute = [...messages].reverse().flatMap((m) => m.cards ?? []).find((c): c is RouteCard => c.type === 'routes')
  const lastTour = [...messages].reverse().flatMap((m) => m.cards ?? []).find((c): c is TourCard => c.type === 'tour')
  const lastPrefsAt = [...messages].reverse().find((m) => m.cards?.some((c) => c.type === 'prefs'))?.at
  const prefsAnswered = !!lastPrefsAt && messages.some((m) => m.role === 'user' && m.at > lastPrefsAt && /^my preferences:/i.test(m.text))

  return (
    <div className="mx-auto flex max-w-[1440px] gap-0 overflow-hidden" style={{ height: 'calc(100dvh - var(--nav-h))' }}>
      {/* chats */}
      <aside className={`${side ? 'fixed inset-0 z-40 block bg-surface-primary p-4' : 'hidden'} w-full shrink-0 overflow-y-auto border-e border-edge p-3 md:static md:block md:w-[260px]`} aria-label="Your chats">
        <div className="mb-2 flex items-center gap-2">
          <button type="button" className="btn flex-1" onClick={() => { setPending([]); setSide(false); navigate('/ai') }}><Plus className="h-4 w-4" />New chat</button>
          <button type="button" className="btn-secondary !h-11 !w-11 !p-0 md:hidden" aria-label="Close chats" onClick={() => setSide(false)}><X className="h-4 w-4" /></button>
        </div>
        <ul className="space-y-0.5">
          {chats.map((c) => (
            <li key={c.id} className={`group flex items-center gap-1 rounded-xl px-2 py-2 ${c.id === chatId ? 'bg-accent-subtle' : 'hover:bg-surface-secondary'}`}>
              <Link to={`/ai/${c.id}`} onClick={() => setSide(false)} className="min-w-0 flex-1 truncate text-body text-content" title={c.title}>{c.title}</Link>
              <button type="button" aria-label={`Delete chat ${c.title}`} className="opacity-50 hover:opacity-100" onClick={() => void remove(c.id)}><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
          {!chats.length && <li className="px-2 text-caption text-content-faint">Your chats appear here and stay on every device you sign in on.</li>}
        </ul>
      </aside>

      {/* conversation */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Tripzy AI chat">
        <div className="flex items-center gap-2 border-b border-edge px-4 py-2">
          <button type="button" className="btn-secondary !h-9 !w-9 !p-0 md:hidden" aria-label="Show chats" onClick={() => setSide(true)}><Menu className="h-4 w-4" /></button>
          <Sparkles className="h-4 w-4 text-[var(--tz-sun)]" />
          <p className="font-serif text-[22px] leading-none text-content">Tripzy AI</p>
          <span className="ms-auto flex flex-wrap items-center gap-2 text-caption text-content-muted">
            {here ? <span title={here.name}>📍 {here.name}</span> : <button type="button" className="btn-link inline-flex items-center gap-1" onClick={locate}><LocateFixed className="h-3.5 w-3.5" />Use my live location</button>}
            {locMsg && <span className="text-warning">{locMsg}</span>}
            <button type="button" className="btn-link inline-flex items-center gap-1" aria-pressed={speak} onClick={() => { const v = !speak; setSpeak(v); try { localStorage.setItem('tripzy:ai:speak', v ? '1' : '0') } catch { /* blocked */ } if (!v) window.speechSynthesis?.cancel() }}>
              {speak ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}{speak ? 'Reading aloud' : 'Read aloud'}
            </button>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
          <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
            {!messages.length && (
              <div className="pt-6 text-center">
                <p className="font-serif text-[36px] leading-tight text-content">Where to, {profile.name.split(' ')[0] || 'traveller'}?</p>
                <p className="mt-2 text-body text-content-muted">Type or speak. I plan the whole journey — metro, bus, auto, cab, your own vehicle, trains and flights — and fill Daily Traveller and the Tourist Planner for you.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {EXAMPLES.map((e) => <button key={e} type="button" className="chip chip-off" onClick={() => void send.run(e)}>{e}</button>)}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.at} className={m.role === 'user' ? 'ms-auto w-fit max-w-[85%] rounded-3xl bg-accent px-4 py-2.5 text-accent-text' : 'flex gap-3'}>
                {m.role === 'user' ? m.text : (
                  <>
                    <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-subtle" aria-hidden><Sparkles className="h-4 w-4 text-accent-on" /></span>
                    <div className="min-w-0 flex-1 space-y-1 text-body text-content">
                      <RichText text={m.text} />
                      {m.cards?.map((c, i) => (
                        <CardView key={i} c={c} tripId={m.tripId ?? (c.type === 'tour' ? state.tripId : undefined)} creating={creating}
                          onPrefs={() => (m.at === lastPrefsAt && !prefsAnswered ? <PrefsPicker prefs={prefs} busy={send.busy} onSave={(p, s) => void savePicked(p, s)} /> : <p className="text-caption text-content-faint">✓ Preferences saved</p>)} />
                      ))}
                      {!!m.sources?.length && <p className="text-caption text-content-faint">Sources: {m.sources.slice(0, 4).join(' · ')}{m.engine === 'rules' ? ' · answered by Tripzy\'s planner (AI model busy)' : ''}</p>}
                    </div>
                  </>
                )}
              </div>
            ))}
            {send.busy && <p className="ps-11 text-body text-content-muted">Planning with live data…</p>}
            {send.error && <ErrorBox message={send.error} onRetry={() => void send.retry()} />}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-edge bg-surface-primary px-4 py-3">
          {state.route && <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">{QUICK_EDITS.map((q) => <button key={q} type="button" className="chip chip-off !py-1 text-caption" disabled={send.busy} onClick={() => void send.run(q)}>{q}</button>)}</div>}
          <form onSubmit={submit} className="mx-auto flex max-w-3xl items-center gap-2 rounded-3xl border border-edge bg-surface-card p-1.5 shadow-sm">
            <input className="tz-input flex-1 !border-0 !bg-transparent" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={state.route ? 'Change it: "cheaper", "avoid buses", "leave at 8"…' : 'Ask Tripzy AI — "Kokapet to Miyapur, I am in a hurry"'} aria-label="Message Tripzy AI" disabled={send.busy} />
            {speech.supported && (
              <button type="button" className={`btn-secondary !h-10 !w-10 !rounded-full !p-0 ${speech.on ? 'ring-2 ring-[var(--accent)]' : ''}`} aria-label={speech.on ? 'Stop listening' : 'Speak'} onClick={speech.toggle}>
                {speech.on ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <button className="btn !h-10 !w-10 !rounded-full !p-0" disabled={send.busy || !draft.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
          </form>
        </div>
      </section>

      {/* the plan the chat is working on — the same as the manual pages */}
      <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-s border-edge p-4 xl:block" aria-label="Your plan">
        <div className="tz-kicker">Your plan</div>
        {!state.route && !lastTour && <p className="mt-2 text-body text-content-muted">What you plan here appears in Daily Traveller and the Tourist Planner — edit it here or there.</p>}
        {state.route && (
          <div className="mt-2 space-y-2">
            <p className="font-serif text-[24px] leading-tight text-content">{state.route.from ?? 'Here'} → {state.route.to}</p>
            <p className="text-caption text-content-muted">{state.route.date} · {state.route.time}{state.route.priority ? ` · ${state.route.priority}` : ''}{state.route.luggage ? ` · ${state.route.luggage} bags` : ''}{state.route.avoid?.length ? ` · no ${state.route.avoid.join(', ')}` : ''}</p>
            {lastRoute && <RouteView c={lastRoute} />}
            {state.commuteUrl && <Link className="btn w-full" to={state.commuteUrl}>Open in Daily Traveller</Link>}
          </div>
        )}
        {lastTour && <div className="mt-4"><CardView c={lastTour} tripId={state.tripId} creating={creating} onPrefs={() => null} /></div>}
        <div className="mt-6 rounded-2xl bg-surface-secondary p-3 text-caption text-content-secondary">
          <p className="font-semibold text-content">Your preferences</p>
          <p>{prefs.modes.map((m) => MODE_LABEL[m]).join(', ')} · {prefs.luggage ?? 'light'} bags · {prefs.priority ?? 'balanced'}{prefs.vehicles?.car ? ' · car' : ''}{prefs.vehicles?.scooter ? ' · scooter' : ''}</p>
          <button type="button" className="btn-link mt-1" onClick={() => void send.run('Change my preferences')}>Change</button>
        </div>
      </aside>
    </div>
  )
}
