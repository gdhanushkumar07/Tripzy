import { useState } from 'react'
import { AlertTriangle, Bike, Car, ChevronDown, CloudRain, Coffee, Footprints, Lock, MapPin, ShieldCheck, Sparkles, Train, Trash2, Users, Utensils, Zap } from 'lucide-react'
import type { Block, Check, Day } from './types'
import { rupees } from './engine'
import { PlaceImage } from './ui'

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

/**
 * The day as a journey: one continuous line, with stops, meals, rests and
 * bookings as markers on it and travel between them as quiet connectors.
 * Time-Truth flags, Plan B and meal decision cards sit inline with each stop.
 */
export default function IntelTimeline({ day, onChoose, onRemove, onSelect, selected, nowMin, compact }: Props) {
  let n = 0
  const risks = day.verify.checks.filter((c) => c.level !== 'ok')
  return (
    <ol className="relative">
      <span aria-hidden className="absolute bottom-3 top-3 w-px bg-[var(--border-primary)]" style={{ insetInlineStart: 79.5 }} />
      {day.blocks.map((b) => {
        if (b.kind === 'place') n += 1
        const past = nowMin !== undefined && b.e <= nowMin
        const live = nowMin !== undefined && b.s <= nowMin && nowMin < b.e && b.kind !== 'leg'
        const flags = b.kind === 'place' ? risks.filter((c) => c.text.includes(b.name)) : []
        return (
          <li key={b.id} className={`relative ${past ? 'opacity-50' : ''}`} onClick={() => onSelect?.(b)}>
            {b.kind === 'leg' ? <Leg b={b} /> : b.kind === 'anchor' ? <Anchor b={b} /> : (
              <Stop b={b} n={n} live={live} flags={flags} onChoose={onChoose} onRemove={onRemove} active={selected === b.id} compact={compact} />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Row({ b, marker, children }: { b: Block; marker: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[56px_32px_minmax(0,1fr)] gap-x-2 py-3">
      <div className="pt-0.5 text-end leading-tight tabular-nums">
        <div className="font-serif text-[21px] text-content">{b.start}</div>
        <div className="text-[11px] text-content-faint">{b.end}</div>
      </div>
      <div className="relative flex justify-center pt-1.5">{marker}</div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Leg({ b }: { b: Block }) {
  return (
    <div className="grid grid-cols-[56px_32px_minmax(0,1fr)] gap-x-2">
      <span />
      <span className="flex justify-center"><span className="my-1 h-full border-s border-dashed border-[var(--tz-stone)]" /></span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-[12px] text-content-muted">
        <span className="inline-flex items-center gap-1.5 text-content-secondary">{modeIcon(b.mode)}<span className="capitalize">{b.mode}</span> · {b.minutes} min · {b.km} km{b.cost ? ` · ${rupees(b.cost)}` : ''}</span>
        {!!b.buffer && <span className="text-accent-on">+{b.buffer} min traffic buffer</span>}
        <span className="ms-auto tabular-nums">leave {b.depart_by}</span>
      </div>
    </div>
  )
}

function Anchor({ b }: { b: Block }) {
  const travel = b.name.startsWith('Arrive') || b.name.startsWith('Depart')
  return (
    <Row b={b} marker={<span className={`grid h-7 w-7 place-items-center rounded-full ring-4 ring-[var(--bg-primary)] ${travel ? 'bg-accent text-accent-text' : 'bg-surface-tertiary text-content-muted'}`}>{travel ? <Train className="h-3.5 w-3.5" /> : <Lock className="h-3 w-3" />}</span>}>
      <div className={travel ? 'rounded-2xl bg-accent-subtle px-4 py-3' : 'pt-1'}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={travel ? 'text-[16px] font-semibold text-content' : 'text-[15px] text-content-secondary'}>{b.name}</span>
          {b.fixed && <span className="inline-flex items-center gap-1 rounded-full bg-surface-card px-2 py-0.5 text-[11px] font-medium text-accent-on"><Lock className="h-3 w-3" />Fixed booking</span>}
        </div>
        {b.delay_risk && <p className="mt-1 text-[13px] text-content-muted">{b.delay_risk}</p>}
      </div>
    </Row>
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
  const markerBg = isPlace ? 'bg-accent text-accent-text' : isMeal ? 'bg-[var(--tz-sun)] text-[#18211F]' : 'bg-surface-tertiary text-content-muted'
  const meta = [
    isPlace ? (b.indoor ? 'Indoor' : 'Outdoor') : null,
    `${b.dwell} min`,
    b.cost ? rupees(b.cost) : null,
    isPlace ? `${Math.round(b.energy || 0)} energy` : null,
  ].filter(Boolean).join(' · ')
  return (
    <Row b={b} marker={
      <span className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold ring-4 ring-[var(--bg-primary)] ${markerBg} ${live ? 'outline outline-2 outline-offset-2 outline-[var(--tz-sun)]' : ''}`}>
        {isPlace ? n : isMeal ? <Utensils className="h-3.5 w-3.5" /> : <Coffee className="h-3.5 w-3.5" />}
      </span>
    }>
      <div className={`rounded-2xl transition ${active ? 'bg-accent-subtle p-3 -m-3' : ''}`}>
        <div className="flex gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h4 className={`${isPlace ? 'font-serif text-[24px] leading-tight' : 'text-[16px] font-semibold'} text-content`}>{b.name}</h4>
              {live && <span className="rounded-full bg-[var(--tz-sun)] px-2 py-0.5 text-[11px] font-semibold text-[#18211F]">Now</span>}
              {isMeal && <span className="text-[12px] capitalize text-[var(--tz-coral)]">{b.meal}</span>}
              {b.diet === 'veg' && <span className="text-[12px] text-success">veg</span>}
              {b.user_locked && <span className="text-[12px] text-content-muted">your pick</span>}
              {b.feedback && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] text-warning">{b.feedback === 'loved' ? 'Loved it' : b.feedback === 'skip' ? 'Skip next time' : 'It was okay'}</span>}
            </div>
            {b.why && (
              <p className="mt-1.5 flex gap-1.5 text-[15px] leading-relaxed text-content-secondary">
                <Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--tz-sun)]" /><span>{b.why}</span>
              </p>
            )}
            {!compact && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-content-muted">
                {meta && <span className="inline-flex items-center gap-1">{isPlace && <Zap className="h-3 w-3" />}{meta}</span>}
                {inBest && <span className="text-success">Best time · {b.best![2]}</span>}
                {!!b.wait && b.wait > 5 && <span className="text-warning">{b.wait} min free before</span>}
                {b.shortened && <span className="text-warning">Shortened to fit opening hours</span>}
              </div>
            )}
            {flags.map((f) => (
              <div key={f.text} className={`mt-2 flex gap-1.5 rounded-xl px-3 py-2 text-[13px] ${f.level === 'risk' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{f.text}
              </div>
            ))}
            {isPlace && !compact && (pb.rain || pb.crowd || pb.tired) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="me-1 font-serif text-[15px] italic text-content-muted">Plan B</span>
                {pb.rain?.place_id && <Alt icon={<CloudRain className="h-3 w-3" />} label={`Rain: ${pb.rain.name}`} onClick={() => onChoose?.(b, pb.rain!.place_id!)} />}
                {pb.crowd?.place_id && <Alt icon={<Users className="h-3 w-3" />} label={`Crowd: ${pb.crowd.name}`} onClick={() => onChoose?.(b, pb.crowd!.place_id!)} />}
                {pb.tired && (pb.tired.place_id
                  ? <Alt icon={<Coffee className="h-3 w-3" />} label={`Tired: ${pb.tired.name}`} onClick={() => onChoose?.(b, pb.tired!.place_id!)} />
                  : <span className="rounded-full bg-surface-secondary px-2.5 py-0.5 text-content-secondary">Tired: {pb.tired.shorten}-min version</span>)}
              </div>
            )}
            {isMeal && b.options && b.options.length > 1 && onChoose && (
              <div className="mt-2.5">
                <button type="button" onClick={(e) => (e.stopPropagation(), setOpen(!open))} className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent-on">
                  Compare {b.options.length} options <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {b.options.map((o) => (
                      <button type="button" key={o.place_id} onClick={(e) => (e.stopPropagation(), onChoose(b, o.place_id))}
                        className={`rounded-2xl border p-3 text-start text-[12px] transition hover:border-[var(--accent)] ${o.place_id === b.place_id ? 'border-[var(--accent)] bg-accent-subtle' : 'border-edge bg-surface-card'}`}>
                        <div className="text-[14px] font-semibold text-content">{o.name}</div>
                        <div className="mt-1 text-content-muted">{o.minutes} min {o.mode} · {rupees(o.cost)}{o.diet === 'veg' ? ' · veg' : ''}</div>
                        <div className="mt-1 text-content-secondary">{o.note}</div>
                        {o.pick && <div className="mt-1.5 font-semibold text-[var(--tz-coral)]">Tripzy pick</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {isPlace && !compact && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-content-faint">
                <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Verified · hours checked {b.verified_at}</span>
                <a className="inline-flex items-center gap-1 text-content-muted hover:text-content" target="_blank" rel="noreferrer"
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
          {isPlace && !compact && (
            <PlaceImage id={b.place_id} cat={b.cat} alt={b.name} className="hidden aspect-[4/3] w-[168px] shrink-0 rounded-2xl sm:block" />
          )}
        </div>
      </div>
    </Row>
  )
}

function Alt({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => (e.stopPropagation(), onClick())}
      className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface-card px-2.5 py-1 font-medium text-content-secondary transition hover:border-[var(--accent)] hover:text-accent-on">
      {icon}{label}
    </button>
  )
}
