/** Tripzy UI kit: built on the platform's semantic tokens (light + dark). */
import React, { useEffect, useState } from 'react'
import { Landmark, Utensils, Coffee, Trees, ShoppingBag, Eye, Theater, Church } from 'lucide-react'

export function Card({ children, className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-[22px] border border-edge bg-surface-card ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`tz-kicker ${className}`}>{children}</div>
}

export function Pill({ children, tone = 'neutral', className = '' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'coral'; className?: string }) {
  const tones: Record<string, string> = {
    neutral: 'bg-surface-secondary text-content-secondary',
    accent: 'bg-accent-subtle text-accent-on',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    coral: 'tz-coral-pill',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-medium ${tones[tone]} ${className}`}>{children}</span>
}

export function Button({ variant = 'primary', className = '', children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'coral' | 'danger' }) {
  const v: Record<string, string> = {
    primary: 'bg-accent text-accent-text hover:bg-accent-hover',
    secondary: 'bg-surface-card text-content border border-edge hover:bg-surface-hover',
    ghost: 'text-content-secondary hover:bg-surface-hover',
    coral: 'tz-coral-btn',
    danger: 'bg-danger-soft text-danger hover:opacity-90',
  }
  return (
    <button type="button" className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-body font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 ${v[variant]} ${className}`} {...rest}>
      {children}
    </button>
  )
}

export function ScoreRing({ score, size = 56, label }: { score: number; size?: number; label?: string }) {
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  const color = score >= 85 ? 'var(--success)' : score >= 70 ? 'var(--warning)' : 'var(--danger)'
  return (
    <div className="flex items-center gap-2.5" title={`Feasibility ${score}/100`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border-primary)" strokeWidth="6" fill="none" />
          <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="6" fill="none" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: 'stroke-dashoffset .5s' }} />
        </svg>
        <span className="absolute inset-0 grid place-items-center font-bold text-content tabular-nums" style={{ fontSize: size / 3.4 }}>{score}</span>
      </div>
      {label && <span className="text-caption leading-tight text-content-muted">{label}</span>}
    </div>
  )
}

export function energyWord(pct: number) {
  return pct > 100 ? 'Overloaded' : pct > 85 ? 'Heavy' : pct > 55 ? 'Comfortable' : 'Relaxed'
}

export function EnergyBar({ pct, sub, compact }: { pct: number; sub?: string; compact?: boolean }) {
  const color = pct > 100 ? 'var(--danger)' : pct > 85 ? 'var(--warning)' : 'var(--success)'
  return (
    <div className={compact ? 'min-w-[110px]' : 'min-w-[150px]'}>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-caption">
        <span className="text-content-muted">Energy</span>
        <span className="font-semibold text-content">{pct}% · {energyWord(pct)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-tertiary">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
      {sub && <div className="mt-1 text-[11px] text-content-faint">{sub}</div>}
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-caption text-content-muted">{label}</div>
      <div className="truncate text-subtitle font-semibold text-content">{value}</div>
      {sub && <div className="text-[11px] text-content-faint">{sub}</div>}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-surface-tertiary ${className}`} />
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-1 rounded-xl bg-surface-secondary p-1" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={`h-8 rounded-lg px-3 text-body font-medium transition-colors ${value === o.value ? 'bg-surface-card text-content shadow-sm' : 'text-content-muted hover:text-content'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toast({ text, onClose, tone = 'neutral' }: { text: string; onClose: () => void; tone?: 'neutral' | 'success' | 'danger' }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [text, onClose])
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[3000] flex justify-center px-4">
      <div role="status" className={`pointer-events-auto flex max-w-lg items-start gap-3 rounded-2xl px-4 py-3 text-body shadow-modal bg-inverse text-inverse-text ${tone === 'danger' ? 'ring-2 ring-[var(--danger)]' : ''}`}>
        <span className="flex-1">{text}</span>
        <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-70 hover:opacity-100">✕</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- photography

/**
 * Wikipedia article for each curated place (real, attributed photography).
 * Places without an article are left out on purpose: they go straight to the
 * local fallback instead of costing a request that can only 404.
 */
const WIKI: Record<string, string> = {
  'hyd-charminar': 'Charminar', 'hyd-mecca': 'Mecca_Masjid,_Hyderabad', 'hyd-laad': 'Laad_Bazaar',
  'hyd-chowmahalla': 'Chowmahalla_Palace', 'hyd-salarjung': 'Salar_Jung_Museum', 'hyd-golconda': 'Golconda_Fort',
  'hyd-golconda-show': 'Golconda_Fort', 'hyd-qutbshahi': 'Qutb_Shahi_tombs', 'hyd-birla': 'Birla_Mandir,_Hyderabad',
  'hyd-hussainsagar': 'Hussain_Sagar', 'hyd-museum': 'Telangana_State_Archaeology_Museum', 'hyd-zoo': 'Nehru_Zoological_Park',
  'hyd-shilparamam': 'Shilparamam', 'hyd-cablebridge': 'Durgam_Cheruvu_Bridge', 'hyd-ramoji': 'Ramoji_Film_City',
  'hyd-sudhacars': 'Sudha_Cars_Museum', 'hyd-paigah': 'Paigah_Tombs', 'hyd-kbr': 'Kasu_Brahmananda_Reddy_National_Park',
  'jai-amber': 'Amber_Fort', 'jai-jalmahal': 'Jal_Mahal', 'jai-nahargarh': 'Nahargarh_Fort',
  'jai-hawamahal': 'Hawa_Mahal', 'jai-citypalace': 'City_Palace,_Jaipur', 'jai-jantar': 'Jantar_Mantar,_Jaipur',
  'jai-albert': 'Albert_Hall_Museum', 'jai-galta': 'Galtaji', 'jai-birla': 'Birla_Mandir,_Jaipur',
  'city:hyderabad': 'Charminar', 'city:jaipur': 'Hawa_Mahal',
}

/**
 * Local, self-hosted photos of these exact places (public/stories, credited on
 * /credits). Used when Wikipedia is slow or unreachable. Other places fall back
 * to a designed name tile: never a photo of a different landmark.
 */
const LOCAL: Record<string, string> = {
  'hyd-charminar': 'charminar', 'hyd-golconda': 'golconda', 'hyd-golconda-show': 'golconda',
  'hyd-chowmahalla': 'chowmahalla-palace', 'hyd-qutbshahi': 'qutb-shahi-tombs', 'hyd-mecca': 'makkah-masjid-hyderabad',
  'hyd-salarjung': 'salar-jung-museum', 'hyd-hussainsagar': 'hussain-sagar', 'hyd-birla': 'birla-mandir-hyderabad',
  'jai-amber': 'amber-fort', 'jai-hawamahal': 'hawa-mahal', 'jai-jalmahal': 'jal-mahal', 'jai-jantar': 'jantar-mantar-jaipur',
  'jai-nahargarh': 'nahargarh-fort', 'city:hyderabad': 'charminar', 'city:jaipur': 'hawa-mahal',
}
export function localFallback(id?: string | null): string | null {
  return id && LOCAL[id] ? `/stories/${LOCAL[id]}-sm.webp` : null
}

// Resolved URLs survive reloads (7 days), so the same photo is never looked up twice.
const STORE_KEY = 'tripzy:photos:v2'
const TTL = 7 * 86400_000
const memo = new Map<string, Promise<string | null>>()
let stored: Record<string, { u: string | null; t: number }> | null = null
function readStore() {
  if (stored) return stored
  try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') } catch { stored = {} }
  return stored!
}
function remember(title: string, u: string | null) {
  const st = readStore()
  st[title] = { u, t: Date.now() }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(st)) } catch { /* storage full or blocked: the in-memory cache still works */ }
}

/** Resolve an image URL only once it has actually loaded (no broken-image icons). */
function verify(url: string, timeoutMs = 9000): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const t = window.setTimeout(() => resolve(null), timeoutMs)
    img.onload = () => { window.clearTimeout(t); resolve(img.naturalWidth > 0 ? url : null) }
    img.onerror = () => { window.clearTimeout(t); resolve(null) }
    img.decoding = 'async'
    img.src = url
  })
}

export function placePhoto(id?: string | null): Promise<string | null> {
  const title = id ? WIKI[id] : undefined
  if (!title) return Promise.resolve(null)
  const hit = readStore()[title]
  if (hit && Date.now() - hit.t < TTL && (hit.u || Date.now() - hit.t < 3600_000)) return Promise.resolve(hit.u)
  if (!memo.has(title)) {
    memo.set(title, fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { thumbnail?: { source?: string } } | null) => {
        const src = j?.thumbnail?.source
        return src ? verify(src.replace(/\/\d+px-/, '/500px-')) : null
      })
      .then((u) => { remember(title, u); return u })
      .catch(() => null))
  }
  return memo.get(title)!
}

/** undefined while resolving, then a URL or null. */
export function usePlacePhoto(id?: string | null): string | null {
  return usePlacePhotoState(id) ?? null
}
export function usePlacePhotoState(id?: string | null): string | null | undefined {
  const [src, setSrc] = useState<string | null | undefined>(id && WIKI[id] ? undefined : null)
  useEffect(() => {
    let alive = true
    if (!id || !WIKI[id]) { setSrc(null); return }
    setSrc(undefined)
    placePhoto(id).then((s) => alive && setSrc(s))
    return () => { alive = false }
  }, [id])
  return src
}

const CAT_ICON: Record<string, React.ElementType> = {
  heritage: Landmark, museum: Landmark, religious: Church, market: ShoppingBag, nature: Trees,
  viewpoint: Eye, show: Theater, entertainment: Theater, food: Utensils, cafe: Coffee,
}

/**
 * Place photography with a loading state, a fixed box (no layout shift) and an
 * intentional fallback: a matching local photo, or a designed tile for places
 * like restaurants where a stand-in photo would mislead.
 */
export function PlaceImage({ id, cat, className = '', alt }: { id?: string | null; cat?: string; className?: string; alt: string }) {
  const remote = usePlacePhotoState(id)
  const [failed, setFailed] = useState<string | null>(null)
  const local = localFallback(id)
  const src = remote && remote !== failed ? remote : remote === undefined ? undefined : local && local !== failed ? local : null
  const Icon = CAT_ICON[cat || ''] ?? Landmark
  if (src === undefined) return <div className={`animate-pulse bg-surface-tertiary motion-reduce:animate-none ${className}`} aria-hidden />
  if (src) return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(src)} className={`object-cover ${className}`} />
  return (
    <div className={`tz-place-tile relative flex flex-col justify-end overflow-hidden p-3 text-[#F7F5EF] ${className}`} role="img" aria-label={alt}>
      <Icon className="absolute end-3 top-3 h-5 w-5 text-[#D98955]" aria-hidden />
      <span className="line-clamp-2 font-serif text-[18px] leading-tight">{alt}</span>
    </div>
  )
}
