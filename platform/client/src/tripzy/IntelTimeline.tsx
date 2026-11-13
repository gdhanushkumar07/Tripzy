import { useState } from 'react'
import { AlertTriangle, Bike, Car, ChevronDown, CloudRain, Coffee, Footprints, Lock, MapPin, ShieldCheck, Sparkles, Train, Trash2, Users, Utensils, Zap } from 'lucide-react'
import type { Block, Check, Day } from './types'
import { rupees } from './engine'
import { PlaceImage, Pill } from './ui'

const modeIcon = (m?: string) =>
  m === 'walk' ? <Footprints className="h-3.5 w-3.5" /> : m === 'auto' ? <Bike className="h-3.5 w-3.5" /> : <Car className="h-3.5 w-3.5" />

type Props = {
  day: Day
  onChoose?: (block: Block, placeId: string) => void
  onRemove?: (block: Block) => void
  onSelect?: (block: Block) => void
  selected?: string
  nowMin?: number
  compact?: boolean
}

/** Day timeline with Time-Truth flags, Plan B and Decision Cards inline. */
export default function IntelTimeline({ day, onChoose, onRemove, onSelect, selected, nowMin, compact }: Props) {
  let n = 0
  const risks = day.verify.checks.filter((c) => c.level !== 'ok')
  return (
    <ol className="relative space-y-2.5">
      {day.blocks.map((b) => {
        if (b.kind === 'place') n += 1
        const past = nowMin !== undefined && b.e <= nowMin
        const live = nowMin !== undefined && b.s <= nowMin && nowMin < b.e && b.kind !== 'leg'
        const flags = b.kind === 'place' ? risks.filter((c) => c.text.includes(b.name)) : []
        return (
          <li key={b.id} className={`tz-rise ${past ? 'opacity-55' : ''}`} onClick={() => onSelect?.(b)}>
            {b.kind === 'leg' ? <Leg b={b} /> : b.kind === 'anchor' ? <Anchor b={b} /> : (
              <Stop b={b} n={n} live={live} flags={flags} onChoose={onChoose} onRemove={onRemove} active={selected === b.id} compact={compact} />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Leg({ b }: { b: Block }) {
  return (
    <div className="ml-[64px] flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-dashed border-edge py-1 pl-4 text-caption text-content-muted">
      <span className="inline-flex items-center gap-1.5 font-medium text-content-secondary">{modeIcon(b.mode)}<span className="capitalize">{b.mode}</span> · {b.minutes} min</span>
      <span>{b.km} km</span>
      {!!b.cost && <span>{rupees(b.cost)}</span>}
      {!!b.buffer && <Pill tone="accent" className="!py-0 text-[11px]">+{b.buffer} min traffic buffer</Pill>}
      <span className="ml-auto tabular-nums">leave {b.depart_by}</span>
    </div>
  )
}

function Time({ b }: { b: Block }) {
  return (
    <div className="w-[56px] shrink-0 pt-3 text-right leading-tight tabular-nums">
      <div className="text-body font-semibold text-content">{b.start}</div>
      <div className="text-caption text-content-faint">{b.end}</div>
    </div>
  )
}

function Anchor({ b }: { b: Block }) {
  const travel = b.name.startsWith('Arrive') || b.name.startsWith('Depart')
  return (
    <div className="flex gap-3">
      <Time b={b} />
      <div className={`flex-1 rounded-2xl border px-4 py-3 ${travel ? 'border-transparent bg-accent-subtle' : 'border-edge bg-surface-card'}`}>
        <div className="flex flex-wrap items-center gap-2 font-semibold text-content">
          {travel ? <Train className="h-4 w-4 text-accent-on" /> : <Lock className="h-4 w-4 text-content-muted" />}
          {b.name}
          {b.fixed && <Pill tone="accent"><Lock className="h-3 w-3" />Fixed booking</Pill>}
        </div>
        {b.delay_risk && <p className="mt-1 text-caption text-content-muted">{b.delay_risk}</p>}
      </div>
    </div>
  )
}

function Stop({ b, n, live, flags, onChoose, onRemove, active, compact }: {
  b: Block; n: number; live: boolean; flags: Check[]; onChoose?: Props['onChoose']; onRemove?: Props['onRemove']; active?: boolean; compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const isPlace = b.kind === 'place'
  const isMeal = b.kind === 'meal'
  const inBest = b.best && b.start >= b.best[0] && b.start <= b.best[1]
  const pb = b.plan_b || {}
  const ring = live ? 'ring-2 ring-[var(--tz-coral)]' : active ? 'ring-2 ring-[var(--accent)]' : ''
  return (
    <div className="flex gap-3">
      <Time b={b} />
      <div className={`flex-1 overflow-hidden rounded-2xl border border-edge bg-surface-card shadow-card transition ${ring} ${b.kind === 'rest' ? '!bg-success-soft' : ''}`}>
        <div className="flex gap-3 p-3">
          {isPlace && !compact && (
            <PlaceImage id={b.place_id} cat={b.cat} alt={b.name} className="hidden h-[88px] w-[112px] shrink-0 rounded-xl sm:block" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${isPlace ? 'bg-accent' : isMeal ? '' : 'bg-success'}`}
                style={isMeal ? { background: 'var(--tz-coral)' } : undefined}>
                {isPlace ? n : isMeal ? <Utensils className="h-3.5 w-3.5" /> : <Coffee className="h-3.5 w-3.5" />}
              </span>
              <h4 className="font-semibold text-content">{b.name}</h4>
              {isMeal && <Pill tone="coral" className="capitalize">{b.meal}</Pill>}
              {b.diet === 'veg' && <Pill tone="success">veg</Pill>}
              {live && <Pill tone="coral">Now</Pill>}
              {b.user_locked && <Pill>your pick</Pill>}
              {b.feedback && <Pill tone="warning">{b.feedback === 'loved' ? 'Loved it' : b.feedback === 'skip' ? 'Skip next time' : 'It was okay'}</Pill>}
            </div>
            {b.why && (
              <p className="mt-1.5 flex gap-1.5 text-body text-content-secondary">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 tz-coral-text" />
                <span>{b.why}</span>
              </p>
            )}
            {!compact && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {inBest && <Pill tone="success">Best time · {b.best![2]}</Pill>}
                {!!b.wait && b.wait > 5 && <Pill tone="warning">{b.wait} min free time before</Pill>}
                {b.shortened && <Pill tone="warning">Shortened to fit opening hours</Pill>}
                {isPlace && <Pill><Zap className="h-3 w-3" />{Math.round(b.energy || 0)} energy</Pill>}
                {!!b.cost && <Pill>{rupees(b.cost)}</Pill>}
                {isPlace && <Pill>{b.indoor ? 'Indoor' : 'Outdoor'}</Pill>}
                <Pill>{b.dwell} min</Pill>
              </div>
            )}
            {flags.map((f) => (
              <div key={f.text} className={`mt-2 flex gap-1.5 rounded-lg px-2.5 py-1.5 text-caption ${f.level === 'risk' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />{f.text}
              </div>
            ))}
            {isPlace && !compact && (pb.rain || pb.crowd || pb.tired) && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-caption">
                <span className="font-semibold text-content-muted">Plan B</span>
                {pb.rain?.place_id && <Alt icon={<CloudRain className="h-3 w-3" />} label={`Rain: ${pb.rain.name}`} onClick={() => onChoose?.(b, pb.rain!.place_id!)} />}
                {pb.crowd?.place_id && <Alt icon={<Users className="h-3 w-3" />} label={`Crowd: ${pb.crowd.name}`} onClick={() => onChoose?.(b, pb.crowd!.place_id!)} />}
                {pb.tired && (pb.tired.place_id
                  ? <Alt icon={<Coffee className="h-3 w-3" />} label={`Tired: ${pb.tired.name}`} onClick={() => onChoose?.(b, pb.tired!.place_id!)} />
                  : <Pill>Tired: {pb.tired.shorten}-min version</Pill>)}
              </div>
            )}
            {isMeal && b.options && b.options.length > 1 && onChoose && (
              <div className="mt-2.5">
                <button type="button" onClick={(e) => (e.stopPropagation(), setOpen(!open))} className="inline-flex items-center gap-1 text-caption font-semibold text-accent-on">
                  Compare {b.options.length} options <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {b.options.map((o) => (
                      <button type="button" key={o.place_id} onClick={(e) => (e.stopPropagation(), onChoose(b, o.place_id))}
                        className={`rounded-xl border p-3 text-left text-caption transition hover:border-[var(--accent)] ${o.place_id === b.place_id ? 'border-[var(--accent)] bg-accent-subtle' : 'border-edge'}`}>
                        <div className="text-body font-semibold text-content">{o.name}</div>
                        <div className="mt-1 text-content-muted">{o.minutes} min {o.mode} · {rupees(o.cost)}{o.diet === 'veg' ? ' · veg' : ''}</div>
                        <div className="mt-1 text-content-secondary">{o.note}</div>
                        {o.pick && <div className="mt-1.5 font-semibold tz-coral-text">Tripzy pick</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {isPlace && !compact && (
          <div className="flex items-center gap-3 border-t border-edge bg-surface-secondary/60 px-3 py-1.5 text-[11px] text-content-faint">
            <ShieldCheck className="h-3.5 w-3.5" />Verified place · hours checked {b.verified_at}
            <a className="ml-auto inline-flex items-center gap-1 text-content-muted hover:text-content" target="_blank" rel="noreferrer"
              href={`https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lon}`} onClick={(e) => e.stopPropagation()}>
              <MapPin className="h-3 w-3" />Map
            </a>
            {onRemove && (
              <button type="button" className="inline-flex items-center gap-1 text-content-muted hover:text-danger" onClick={(e) => (e.stopPropagation(), onRemove(b))}>
                <Trash2 className="h-3 w-3" />Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Alt({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => (e.stopPropagation(), onClick())}
      className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface-card px-2.5 py-0.5 font-medium text-content-secondary transition hover:border-[var(--accent)] hover:text-accent-on">
      {icon}{label}
    </button>
  )
}
