import { ArrowRight, CalendarArrowUp, Check, Clock, Plus, Repeat, Trash2, X } from "lucide-react";
import type { Proposal } from "../lib/types";
import { Spinner } from "./ui";

export default function DiffCard({ p, onAccept, onReject, busy }: { p: Proposal; onAccept: () => void; onReject: () => void; busy?: boolean }) {
  const d = p.diff;
  const empty = !d.dropped.length && !d.moved.length && !d.swapped.length && !d.shifted.length && !d.inserted.length;
  return (
    <div className="fixed inset-0 z-[3000] flex items-end justify-center bg-ink-900/40 p-3 sm:items-center">
      <div className="animate-pop max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
        <div className="label text-accent-600">Ripple Engine · {p.now}</div>
        <h3 className="mt-1 text-xl font-bold">{d.headline}</h3>
        <p className="mt-1 text-sm text-ink-500">Here's the rest of Day {p.day + 1}, already re-planned. Nothing changes until you accept.</p>

        <div className="mt-4 space-y-3 text-sm">
          {d.inserted.map((x) => <Row key={x} icon={<Plus className="h-4 w-4 text-emerald-600" />} text={<>Added <b>{x}</b></>} />)}
          {d.swapped.map((s) => <Row key={s.from} icon={<Repeat className="h-4 w-4 text-brand-600" />} text={<><b>{s.from}</b> <ArrowRight className="inline h-3 w-3" /> <b>{s.to}</b> <span className="text-ink-500">({s.reason})</span></>} />)}
          {d.moved.map((m) => <Row key={m.name} icon={<CalendarArrowUp className="h-4 w-4 text-amber-600" />} text={<>Moved <b>{m.name}</b> to Day {m.to_day} <span className="text-ink-500">({m.reason})</span></>} />)}
          {d.dropped.map((m) => <Row key={m.name} icon={<Trash2 className="h-4 w-4 text-red-600" />} text={<>Dropped <b>{m.name}</b> <span className="text-ink-500">({m.reason})</span></>} />)}
          {d.shifted.length > 0 && (
            <div className="rounded-2xl bg-ink-50 p-3">
              <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-ink-500"><Clock className="h-3.5 w-3.5" /> Re-timed</div>
              {d.shifted.map((s) => (
                <div key={s.name} className="flex justify-between gap-2 py-0.5 text-[13px]">
                  <span className="truncate">{s.name}</span>
                  <span className="shrink-0 text-ink-500">{s.from} → <b className="text-ink-900">{s.to}</b></span>
                </div>
              ))}
            </div>
          )}
          {d.notes.map((n) => <Row key={n} icon={<Check className="h-4 w-4" />} text={n} />)}
          {empty && <p className="text-ink-500">No changes needed. The plan still holds.</p>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-ink-100 p-3 text-center text-xs">
          <div>
            <div className="text-ink-500">Feasibility</div>
            <div className="text-lg font-bold">{d.feasibility.before} → {d.feasibility.after}</div>
          </div>
          <div>
            <div className="text-ink-500">Energy</div>
            <div className="text-lg font-bold">{d.energy.before}% → {d.energy.after}%</div>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button className="btn-ghost flex-1" onClick={onReject} disabled={busy}><X className="h-4 w-4" />Keep original</button>
          <button className="btn-primary flex-1" onClick={onAccept} disabled={busy}>{busy ? <Spinner /> : <Check className="h-4 w-4" />}Accept new plan</button>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, text }: { icon: React.ReactNode; text: React.ReactNode }) {
  return <div className="flex items-start gap-2">{icon}<span>{text}</span></div>;
}
