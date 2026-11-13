import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BatteryLow, CloudRain, Heart, Navigation, Plus, Store, Timer, Train, Wallet } from "lucide-react";
import { api, cacheCapsule, mapsLink, rupees } from "../lib/api";
import type { Block, Capsule, Proposal } from "../lib/types";
import Timeline from "../components/Timeline";
import DiffCard from "../components/DiffCard";
import { EnergyBar, ScoreRing, Spinner, Toast, TopBar } from "../components/ui";

const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default function Live() {
  const { id = "" } = useParams();
  const [c, setC] = useState<Capsule | null>(null);
  const [day, setDay] = useState(0);
  const [now, setNow] = useState(9 * 60);
  const [prop, setProp] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [amt, setAmt] = useState("");

  useEffect(() => {
    api.trip(id).then((x) => {
      setC(x);
      setNow(Math.max(0, (x.days[0].blocks[0]?.s ?? 540) - 30));
    });
  }, [id]);

  const d = c?.days[day];
  const stops = useMemo(() => (d ? d.blocks.filter((b) => b.kind !== "leg") : []), [d]);
  const current = stops.find((b) => b.s <= now && now < b.e);
  const next = stops.find((b) => b.s > now && (!current || b.s >= current.e));
  const legToNext = d && next ? d.blocks.find((b) => b.kind === "leg" && b.e <= next.s && b.s >= (current?.e ?? now) - 1) : undefined;
  const arrivalAnchor = d?.blocks.find((b) => b.kind === "anchor" && b.name.startsWith("Arrive") && b.s > now);
  const toRate = stops.filter((b) => b.kind === "place" && b.e <= now && !b.feedback);

  const refresh = (x: Capsule) => (setC(x), cacheCapsule(x));
  const fire = async (event: Record<string, unknown>) => {
    if (!c) return;
    setBusy(true);
    try {
      const p = await api.ripple(c.id, day, fmt(now), event);
      if (p.auto_apply) {
        refresh(await api.trip(c.id));
        setToast(`${p.diff.headline}. Minor shift auto-applied (${p.diff.shifted.length} stops re-timed).`);
      } else setProp(p);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const accept = async () => {
    if (!c || !prop) return;
    setBusy(true);
    refresh(await api.accept(c.id, prop.id));
    setProp(null);
    setBusy(false);
    setToast("New plan locked in. Leave-by alerts updated.");
  };
  const reject = async () => {
    if (!c || !prop) return;
    await api.reject(c.id, prop.id);
    setProp(null);
  };
  const react = async (b: Block, reaction: string) => {
    if (!c) return;
    const r = await api.feedback(c.id, { day, block_id: b.id, reaction });
    refresh(await api.trip(c.id));
    setToast(r.learned.length ? `Learned: ${r.learned.join("; ")}` : "Thanks, noted.");
  };
  const addExpense = async () => {
    if (!c || !amt) return;
    const budget = await api.expense(c.id, day, +amt, "Quick expense");
    setC({ ...c, budget });
    setAmt("");
    if (budget.over_budget) setToast("Over budget so far. Tip: tell the planner 'cheaper' for the remaining days.");
  };

  if (!c || !d) return <div className="grid h-full place-items-center"><Spinner className="h-8 w-8 text-brand-600" /></div>;
  const dayBudget = c.budget.per_day[day];
  const leaveIn = legToNext ? legToNext.s - now : next ? next.s - now : 0;

  return (
    <div className="min-h-full pb-10">
      <TopBar>
        <span className="chip bg-accent-500 text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-white" />LIVE</span>
        <Link to={`/trip/${c.id}`} className="btn-ghost px-3">Plan</Link>
      </TopBar>
      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-4 lg:grid-cols-[440px_1fr]">
        <section className="space-y-4">
          {/* simulated clock */}
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div className="label">Demo clock</div>
              <select className="rounded-lg border border-ink-100 px-2 py-1 text-sm" value={day}
                onChange={(e) => (setDay(+e.target.value), setNow(Math.max(0, (c.days[+e.target.value].blocks[0]?.s ?? 540) - 30)))}>
                {c.days.map((x) => <option key={x.index} value={x.index}>Day {x.index + 1} · {x.weekday}</option>)}
              </select>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <span className="w-16 text-2xl font-bold tabular-nums">{fmt(now)}</span>
              <input type="range" min={300} max={23 * 60} step={5} value={now} onChange={(e) => setNow(+e.target.value)} className="flex-1 accent-brand-600" />
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setNow(Math.min(23 * 60, now + 30))}>+30m</button>
            </div>
          </div>

          {/* NOW / NEXT */}
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-br from-brand-600 to-brand-900 p-5 text-white">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-100">Now</div>
              <div className="mt-1 text-xl font-bold">{current ? current.name : next ? "Free time" : "Day complete 🎉"}</div>
              {current && <div className="text-sm text-brand-100">until {current.end} · {current.e - now} min left</div>}
            </div>
            {next && (
              <div className="p-5">
                <div className="label">Next</div>
                <div className="mt-1 text-lg font-semibold">{next.name}</div>
                <div className="text-sm text-ink-500">{next.start}–{next.end}{next.why ? ` · ${next.why}` : ""}</div>
                {legToNext && (
                  <div className={`mt-3 flex items-center gap-2 rounded-xl p-3 text-sm ${leaveIn <= 10 ? "bg-accent-50 text-accent-600" : "bg-ink-50"}`}>
                    <Timer className="h-4 w-4" />
                    <span>Leave by <b>{legToNext.depart_by}</b> ({leaveIn > 0 ? `in ${leaveIn} min` : "now"}) · {legToNext.mode} {legToNext.minutes} min{legToNext.cost ? ` · ~${rupees(legToNext.cost)}` : ""}</span>
                  </div>
                )}
                <a className="btn-primary mt-3 w-full" target="_blank" rel="noreferrer" href={mapsLink(next.lat, next.lon, next.name)}>
                  <Navigation className="h-4 w-4" />Navigate
                </a>
              </div>
            )}
          </div>

          {/* triggers */}
          <div className="card p-4">
            <div className="label mb-2">Something changed?</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Trig icon={<Timer />} label="Running 30 min late" onClick={() => fire({ type: "late", minutes: 30 })} busy={busy} />
              <Trig icon={<BatteryLow />} label="I'm tired" onClick={() => fire({ type: "tired" })} busy={busy} />
              <Trig icon={<CloudRain />} label="Rain incoming" onClick={() => fire({ type: "rain", from: fmt(now), to: fmt(now + 180) })} busy={busy} />
              <Trig icon={<Heart />} label="Loving it, +45 min" onClick={() => fire({ type: "extend", minutes: 45 })} busy={busy || !current} />
              <Trig icon={<Store />} label="Next place is closed" onClick={() => next && fire({ type: "closed", block_id: next.id })} busy={busy || next?.kind !== "place"} />
              {arrivalAnchor ? <Trig icon={<Train />} label="Train delayed 2h" onClick={() => fire({ type: "delay", minutes: 120 })} busy={busy} accent />
                : <Trig icon={<Train />} label="Stuck 60 min (traffic)" onClick={() => fire({ type: "late", minutes: 60 })} busy={busy} />}
            </div>
            <p className="mt-2 text-[11px] text-ink-500">Live feeds (train status, weather) raise these automatically. Buttons simulate them for the demo.</p>
          </div>

          {/* micro feedback */}
          {toRate.length > 0 && (
            <div className="card p-4">
              <div className="label mb-2">How was it? (Tripzy learns)</div>
              {toRate.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="truncate">{b.name}</span>
                  <span className="flex shrink-0 gap-1">
                    {[["loved", "❤️"], ["ok", "👍"], ["skip", "👎"]].map(([r, e]) => (
                      <button key={r} className="rounded-lg border border-ink-100 px-2 py-1 hover:border-brand-500" onClick={() => react(b, r)}>{e}</button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* budget */}
          <div className="card p-4">
            <div className="label mb-2 flex items-center gap-1"><Wallet className="h-3.5 w-3.5" />Today's budget</div>
            <div className="flex items-end justify-between text-sm">
              <span>Spent <b>{rupees(dayBudget?.spent ?? 0)}</b> of {rupees(dayBudget?.planned ?? 0)} planned</span>
              {c.budget.over_budget && <span className="chip bg-red-50 text-red-700">over</span>}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
              <div className={`h-full ${c.budget.over_budget ? "bg-red-500" : "bg-brand-600"}`}
                style={{ width: `${Math.min(100, ((dayBudget?.spent ?? 0) / Math.max(1, dayBudget?.planned ?? 1)) * 100)}%` }} />
            </div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), addExpense())}>
              <input className="input" inputMode="numeric" placeholder="₹ amount (UPI / cash)" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ""))} />
              <button className="btn-primary px-3" disabled={!amt}><Plus className="h-4 w-4" /></button>
            </form>
          </div>
        </section>

        <section>
          <div className="card mb-3 flex flex-wrap items-center gap-5 p-4">
            <ScoreRing score={d.verify.score} />
            <EnergyBar pct={d.verify.energy.pct} label={`set by ${d.limiter}`} />
            <Link to={`/trip/${c.id}/capsule`} className="ml-auto text-sm font-semibold text-brand-700">SOS & Capsule →</Link>
          </div>
          <Timeline day={d} nowMin={now} compact />
        </section>
      </main>
      {prop && <DiffCard p={prop} onAccept={accept} onReject={reject} busy={busy} />}
      {toast && <Toast text={toast} onClose={() => setToast("")} />}
    </div>
  );
}

function Trig({ icon, label, onClick, busy, accent }: { icon: React.ReactElement; label: string; onClick: () => void; busy?: boolean; accent?: boolean }) {
  return (
    <button disabled={busy} onClick={onClick}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left font-medium transition disabled:opacity-40 ${accent ? "border-accent-100 bg-accent-50 text-accent-600 hover:border-accent-500" : "border-ink-100 bg-white hover:border-brand-500"}`}>
      <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>{label}
    </button>
  );
}
