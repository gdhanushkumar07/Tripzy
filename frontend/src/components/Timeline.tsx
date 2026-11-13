import { useState } from "react";
import { Bike, Car, ChevronDown, CloudRain, Coffee, Footprints, Lock, MapPin, ShieldCheck, Sparkles, Train, Users, Utensils, Zap } from "lucide-react";
import type { Block, Day } from "../lib/types";
import { rupees } from "../lib/api";

const modeIcon = (m?: string) =>
  m === "walk" ? <Footprints className="h-3.5 w-3.5" /> : m === "auto" ? <Bike className="h-3.5 w-3.5" /> : <Car className="h-3.5 w-3.5" />;

type Props = {
  day: Day;
  onChoose?: (block: Block, placeId: string) => void;
  onSelect?: (block: Block) => void;
  selected?: string;
  nowMin?: number;
  compact?: boolean;
};

export default function Timeline({ day, onChoose, onSelect, selected, nowMin, compact }: Props) {
  let n = 0;
  return (
    <ol className="relative space-y-2">
      {day.blocks.map((b) => {
        if (b.kind === "place") n += 1;
        const past = nowMin !== undefined && b.e <= nowMin;
        const live = nowMin !== undefined && b.s <= nowMin && nowMin < b.e;
        return (
          <li key={b.id} className={`${past ? "opacity-50" : ""} ${live ? "ring-2 ring-accent-500 rounded-2xl" : ""}`}
            onClick={() => onSelect?.(b)}>
            {b.kind === "leg" ? <Leg b={b} /> : b.kind === "anchor" ? <Anchor b={b} /> :
              <Stop b={b} n={n} onChoose={onChoose} active={selected === b.id} compact={compact} />}
          </li>
        );
      })}
    </ol>
  );
}

function Leg({ b }: { b: Block }) {
  return (
    <div className="ml-[58px] flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-dashed border-ink-100 py-1 pl-4 text-xs text-ink-500">
      <span className="inline-flex items-center gap-1 font-medium text-ink-700">{modeIcon(b.mode)} <span className="capitalize">{b.mode}</span> {b.minutes} min</span>
      <span>{b.km} km</span>
      {!!b.cost && <span>{rupees(b.cost)}</span>}
      {!!b.buffer && <span className="chip bg-brand-50 text-brand-700" title="Reliability buffer for traffic">+{b.buffer}m buffer</span>}
      <span className="ml-auto">leave {b.depart_by}</span>
    </div>
  );
}

function Anchor({ b }: { b: Block }) {
  const isTravel = b.name.startsWith("Arrive") || b.name.startsWith("Depart");
  return (
    <div className="flex gap-3">
      <Time b={b} />
      <div className={`flex-1 rounded-2xl border px-4 py-3 ${isTravel ? "border-brand-200 bg-brand-50" : "border-ink-100 bg-white"}`}>
        <div className="flex items-center gap-2 font-semibold">
          {isTravel ? <Train className="h-4 w-4 text-brand-600" /> : <Lock className="h-4 w-4 text-ink-500" />}
          {b.name}
          {b.fixed && <span className="chip bg-white text-brand-700"><Lock className="h-3 w-3" /> fixed</span>}
        </div>
        {b.delay_risk && <p className="mt-1 text-xs text-ink-500">{b.delay_risk}</p>}
      </div>
    </div>
  );
}

function Time({ b }: { b: Block }) {
  return (
    <div className="w-[50px] shrink-0 pt-3 text-right text-xs leading-tight">
      <div className="font-semibold text-ink-900">{b.start}</div>
      <div className="text-ink-500">{b.end}</div>
    </div>
  );
}

function Stop({ b, n, onChoose, active, compact }: { b: Block; n: number; onChoose?: Props["onChoose"]; active?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const isPlace = b.kind === "place";
  const isMeal = b.kind === "meal";
  const inBest = b.best && b.start >= b.best[0] && b.start <= b.best[1];
  const pb = b.plan_b || {};
  return (
    <div className="flex gap-3">
      <Time b={b} />
      <div className={`flex-1 rounded-2xl border bg-white px-4 py-3 transition ${active ? "border-accent-500" : "border-ink-100"} ${b.kind === "rest" ? "bg-emerald-50/60" : ""}`}>
        <div className="flex items-start gap-2">
          <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${isPlace ? "bg-brand-600" : isMeal ? "bg-accent-500" : "bg-emerald-600"}`}>
            {isPlace ? n : isMeal ? <Utensils className="h-3.5 w-3.5" /> : <Coffee className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h4 className="font-semibold leading-snug">{b.name}</h4>
              {isMeal && <span className="chip bg-accent-50 text-accent-600 capitalize">{b.meal}</span>}
              {b.diet === "veg" && <span className="chip bg-emerald-50 text-emerald-700">veg</span>}
              {b.user_locked && <span className="chip bg-ink-100 text-ink-700">your pick</span>}
              {b.feedback && <span className="chip bg-amber-50 text-amber-700">{b.feedback === "loved" ? "❤️ loved" : b.feedback}</span>}
            </div>
            {b.why && <p className="mt-1 flex gap-1 text-[13px] text-ink-700"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-500" />{b.why}</p>}
            {!compact && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {inBest && <span className="chip bg-emerald-50 text-emerald-700">✓ best time: {b.best![2]}</span>}
                {!!b.wait && b.wait > 5 && <span className="chip bg-amber-50 text-amber-700">{b.wait} min {isPlace ? "wait/free" : "free"} time</span>}
                {b.shortened && <span className="chip bg-amber-50 text-amber-700">shortened to fit hours</span>}
                {isPlace && <span className="chip bg-ink-50 text-ink-700"><Zap className="h-3 w-3" />{Math.round(b.energy || 0)} energy</span>}
                {!!b.cost && <span className="chip bg-ink-50 text-ink-700">{rupees(b.cost)}</span>}
                {isPlace && <span className="chip bg-ink-50 text-ink-700">{b.indoor ? "indoor" : "outdoor"}</span>}
              </div>
            )}
            {isPlace && !compact && (pb.rain || pb.crowd || pb.tired) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="font-semibold text-ink-500">Plan B:</span>
                {pb.rain?.place_id && <PlanB icon={<CloudRain className="h-3 w-3" />} label={pb.rain.name!} onClick={() => onChoose?.(b, pb.rain!.place_id!)} />}
                {pb.crowd?.place_id && <PlanB icon={<Users className="h-3 w-3" />} label={pb.crowd.name!} onClick={() => onChoose?.(b, pb.crowd!.place_id!)} />}
                {pb.tired && (pb.tired.place_id ? <PlanB icon={<Coffee className="h-3 w-3" />} label={pb.tired.name!} onClick={() => onChoose?.(b, pb.tired!.place_id!)} />
                  : <span className="chip bg-ink-50 text-ink-500">tired: {pb.tired.shorten} min version</span>)}
              </div>
            )}
            {isMeal && b.options && b.options.length > 1 && onChoose && (
              <div className="mt-2">
                <button onClick={(e) => (e.stopPropagation(), setOpen(!open))} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
                  Decision card: {b.options.length} options <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {b.options.map((o) => (
                      <button key={o.place_id} onClick={(e) => (e.stopPropagation(), onChoose(b, o.place_id))}
                        className={`rounded-xl border p-2.5 text-left text-xs transition hover:border-brand-500 ${o.place_id === b.place_id ? "border-brand-500 bg-brand-50" : "border-ink-100"}`}>
                        <div className="font-semibold text-ink-900">{o.name}</div>
                        <div className="mt-1 text-ink-500">{o.minutes} min {o.mode} · {rupees(o.cost)}{o.diet === "veg" ? " · veg" : ""}</div>
                        <div className="mt-1 text-ink-700">{o.note}</div>
                        {o.pick && <div className="mt-1 font-semibold text-accent-600">★ Tripzy pick</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {isPlace && !compact && b.verified_at && (
              <div className="mt-2 flex items-center gap-1 text-[10px] text-ink-500"><ShieldCheck className="h-3 w-3" />Verified place · hours checked {b.verified_at}
                <a className="ml-auto inline-flex items-center gap-0.5 text-brand-700" target="_blank" rel="noreferrer"
                  href={`https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lon}`} onClick={(e) => e.stopPropagation()}><MapPin className="h-3 w-3" />map</a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanB({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={(e) => (e.stopPropagation(), onClick())} className="chip border border-ink-100 bg-white text-ink-700 hover:border-brand-500 hover:text-brand-700">
      {icon}{label}
    </button>
  );
}
