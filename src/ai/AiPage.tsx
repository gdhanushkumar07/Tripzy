/**
 * Tripzy AI: chat with the planners. Several chats per user (saved in Firestore under
 * users/{uid}/chats, synced across devices and kept on reload), type or speak, results as cards
 * that open in Daily Traveller. The app sends what it knows — live location (if allowed),
 * preferences, saved routes and trips — so answers are personal; the server grounds them in data.
 */
import { collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore'
import { BedDouble, CloudSun, ExternalLink, LocateFixed, Mic, MicOff, Plus, Send, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { fmtDur } from '../commute/engine'
import { api, type GeoPoint } from '../lib/api'
import { useAuth } from '../lib/auth'
import { newId, write } from '../lib/db'
import { db } from '../lib/firebase'
import { currentPosition } from '../lib/location'
import { ErrorBox, useAction } from '../lib/status'

type RouteCard = { type: 'routes'; title: string; url: string; journey: boolean; options: { labels: string[]; minutes: number; fare: number; perPerson: boolean; summary: string }[]; note?: string }
type HotelCard = { type: 'hotels'; title: string; items: { name: string; price?: number; rating?: number; url?: string; km: number }[]; note?: string }
type WeatherCard = { type: 'weather'; title: string; days: { date: string; max: number; min: number; rain: number; summary: string }[] }
type Card = RouteCard | HotelCard | WeatherCard
type Msg = { role: 'user' | 'assistant'; text: string; at: number; cards?: Card[]; engine?: string; sources?: string[] }
type Chat = { id: string; title: string; messages: Msg[]; createdAt: number; updatedAt: number }

const EXAMPLES = [
  'Take me from Kokapet to Miyapur.',
  "I have a scooty but don't want to drive in traffic. Karmanghat to Kokapet",
  'I am in a hurry; show me the fastest option to HITEC City',
  'Hyderabad to Bengaluru for a family of 4 next Saturday',
  'Hotels in Varanasi',
  'How does the group meeting point work?',
]
const LABEL_STYLE: Record<string, string> = {
  Recommended: 'bg-accent text-accent-text', 'Best balanced': 'bg-accent text-accent-text', Fastest: 'bg-accent-subtle text-accent-on', Cheapest: 'bg-success-soft text-success',
  'Most comfortable': 'tz-coral-pill', 'Public transport': 'bg-surface-secondary text-content-secondary',
}
const chatsCol = (uid: string) => collection(db, 'users', uid, 'chats')

/** Speech-to-text with the browser's Web Speech API (Chrome, Edge, Safari); hidden where unsupported. */
type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void }
function useSpeech(onText: (t: string) => void) {
  const Ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition
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

/** Bold (**x**), line breaks and in-app links (/commute?…) in assistant text. */
function RichText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, i) => {
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
        return <p key={i} className={line.trim().startsWith('-') || line.trim().startsWith('•') ? 'ps-3' : ''}>{parts}</p>
      })}
    </>
  )
}

function CardView({ c }: { c: Card }) {
  if (c.type === 'routes') return (
    <div className="mt-2 rounded-2xl border border-edge bg-surface-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-content">{c.title}</p>
        <Link to={c.url} className="btn-secondary btn-sm"><ExternalLink className="h-3.5 w-3.5" />Open with map and booking</Link>
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

export default function AiPage() {
  const { user, profile } = useAuth()
  const { chatId } = useParams()
  const navigate = useNavigate()
  const [chats, setChats] = useState<Chat[]>([])
  const [draft, setDraft] = useState('')
  const [here, setHere] = useState<GeoPoint | null>(null)
  const [locMsg, setLocMsg] = useState('')
  const [memory, setMemory] = useState<{ title: string; text: string }[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const uid = user?.uid

  // all chats, newest first (live: another device or tab shows up at once)
  useEffect(() => {
    if (!uid) return
    return onSnapshot(query(chatsCol(uid), orderBy('updatedAt', 'desc'), limit(50)), (s) => setChats(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Chat, 'id'>) }))))
  }, [uid])

  // personal memory for retrieval: saved routes and trips (titles and summaries only)
  useEffect(() => {
    if (!uid) return
    void Promise.all([
      getDocs(query(collection(db, 'users', uid, 'routes'), orderBy('createdAt', 'desc'), limit(20))).catch(() => null),
      getDocs(query(collection(db, 'users', uid, 'trips'), orderBy('updatedAt', 'desc'), limit(20))).catch(() => null),
    ]).then(([r, t]) => setMemory([
      ...(r?.docs ?? []).map((d) => ({ title: `Saved route: ${d.get('title') ?? ''}`, text: `${d.get('title') ?? ''} at ${d.get('time') ?? ''}. ${d.get('summary') ?? ''}` })),
      ...(t?.docs ?? []).map((d) => ({ title: `Saved trip: ${d.get('title') ?? ''}`, text: `${d.get('title') ?? ''} from ${d.get('start') ?? ''}, ${(d.get('days') as unknown[] | undefined)?.length ?? ''} days` })),
    ]))
  }, [uid])

  const active = useMemo(() => chats.find((c) => c.id === chatId) ?? null, [chats, chatId])
  const [pending, setPending] = useState<Msg[]>([])
  const messages = [...(active?.messages ?? []), ...pending.filter((p) => !(active?.messages ?? []).some((m) => m.at === p.at))]
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages.length])

  const locate = () => { setLocMsg(''); currentPosition().then(setHere, (e: Error) => setLocMsg(e.message)) }
  useEffect(() => { void navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((p) => { if (p.state === 'granted') locate() }).catch(() => undefined) }, [])

  const send = useAction(async (text: string) => {
    if (!uid || !text.trim()) return
    const id = chatId ?? newId()
    const userMsg: Msg = { role: 'user', text: text.trim(), at: Date.now() }
    const history = [...(active?.messages ?? []), userMsg]
    setPending([userMsg]); setDraft('')
    if (!chatId) navigate(`/ai/${id}`, { replace: true })
    const base: Chat = active ?? { id, title: text.trim().slice(0, 60), messages: [], createdAt: Date.now(), updatedAt: Date.now() }
    await write(() => setDoc(doc(db, 'users', uid, 'chats', id), { title: base.title, createdAt: base.createdAt, updatedAt: Date.now(), messages: history }), `chat:${id}:${userMsg.at}`)
    const r = await api.post<{ reply: string; cards: Card[]; engine: string; sources: string[] }>('/api/ai/chat', {
      messages: history.map((m) => ({ role: m.role, text: m.text })),
      context: { location: here ? { lat: here.lat, lon: here.lon, name: here.name } : undefined, prefs: profile.prefs, memory, name: profile.name },
    }, `ai:${id}:${userMsg.at}`)
    const reply: Msg = { role: 'assistant', text: r.reply || 'Done.', at: Date.now(), cards: r.cards, engine: r.engine, sources: r.sources }
    setPending([userMsg, reply])
    await write(() => setDoc(doc(db, 'users', uid, 'chats', id), { title: base.title, createdAt: base.createdAt, updatedAt: Date.now(), messages: [...history, reply].slice(-60) }), `chat:${id}:${reply.at}`)
    setPending([])
  })
  const speech = useSpeech((t) => { setDraft(t); void send.run(t) })
  const submit = (e: FormEvent) => { e.preventDefault(); if (!send.busy) void send.run(draft) }
  const remove = async (id: string) => { if (!uid) return; await deleteDoc(doc(db, 'users', uid, 'chats', id)); if (id === chatId) navigate('/ai') }

  return (
    <div className="mx-auto grid max-w-[1280px] gap-6 px-5 pb-24 pt-10 md:grid-cols-[260px_1fr] md:px-10">
      <aside className="space-y-2" aria-label="Your chats">
        <button type="button" className="btn w-full" onClick={() => { setPending([]); navigate('/ai') }}><Plus className="h-4 w-4" />New chat</button>
        <ul className="space-y-1">
          {chats.map((c) => (
            <li key={c.id} className={`group flex items-center gap-1 rounded-xl px-2 py-1.5 ${c.id === chatId ? 'bg-accent-subtle' : 'hover:bg-surface-secondary'}`}>
              <Link to={`/ai/${c.id}`} className="min-w-0 flex-1 truncate text-body text-content" title={c.title}>{c.title}</Link>
              <button type="button" aria-label={`Delete chat ${c.title}`} className="opacity-60 hover:opacity-100" onClick={() => void remove(c.id)}><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
          {!chats.length && <li className="text-caption text-content-faint">Your chats appear here and stay on every device you sign in on.</li>}
        </ul>
      </aside>

      <section className="flex min-h-[70vh] flex-col" aria-label="Tripzy AI chat">
        <div className="mb-4">
          <div className="tz-chapter">Type or speak — Tripzy plans the whole journey.</div>
          <h1 className="tz-h1 mt-2 text-content">Tripzy AI</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-caption text-content-muted">
            {here ? <>Using your location: <strong>{here.name}</strong></> : <button type="button" className="btn-link inline-flex items-center gap-1" onClick={locate}><LocateFixed className="h-3.5 w-3.5" />Use my live location</button>}
            {locMsg && <span className="text-warning">{locMsg}</span>}
            <span>· Knows your saved modes, vehicles and family from your dashboard.</span>
          </p>
        </div>

        <div className="flex-1 space-y-4" aria-live="polite">
          {!messages.length && (
            <div className="card">
              <p className="flex items-center gap-2 font-semibold text-content"><Sparkles className="h-4 w-4 text-[var(--tz-sun)]" />Try asking</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLES.map((e) => <button key={e} type="button" className="chip chip-off" onClick={() => void send.run(e)}>{e}</button>)}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.at} className={m.role === 'user' ? 'ms-auto max-w-[85%] rounded-2xl bg-accent px-4 py-2 text-accent-text' : 'max-w-[95%]'}>
              {m.role === 'user' ? m.text : (
                <div className="space-y-1 text-body text-content">
                  <RichText text={m.text} />
                  {m.cards?.map((c, i) => <CardView key={i} c={c} />)}
                  {!!m.sources?.length && <p className="text-caption text-content-faint">Sources: {m.sources.slice(0, 4).join(' · ')}{m.engine === 'rules' ? ' · answered without the AI model (offline mode)' : ''}</p>}
                </div>
              )}
            </div>
          ))}
          {send.busy && <p className="text-body text-content-muted">Planning with live data…</p>}
          {send.error && <ErrorBox message={send.error} onRetry={() => void send.retry()} />}
          <div ref={endRef} />
        </div>

        <form onSubmit={submit} className="sticky bottom-4 mt-4 flex items-center gap-2 rounded-2xl border border-edge bg-surface-card p-2 shadow-sm">
          <input className="tz-input flex-1 !border-0" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='e.g. "Kokapet to Miyapur, I am in a hurry"' aria-label="Message Tripzy AI" disabled={send.busy} />
          {speech.supported && (
            <button type="button" className={`btn-secondary !h-11 !w-11 !p-0 ${speech.on ? 'ring-2 ring-[var(--accent)]' : ''}`} aria-label={speech.on ? 'Stop listening' : 'Speak'} onClick={speech.toggle}>
              {speech.on ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          <button className="btn !h-11" disabled={send.busy || !draft.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
        </form>
      </section>
    </div>
  )
}
