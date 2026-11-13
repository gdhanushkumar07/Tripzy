import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Info, MessageSquare, Package, Radio, Send, Ticket } from "lucide-react";
import { api, cacheCapsule, rupees } from "../lib/api";
import type { Block, Capsule } from "../lib/types";
import Timeline from "../components/Timeline";
import MapView from "../components/MapView";
import { EnergyBar, ScoreRing, Spinner, Toast, TopBar } from "../components/ui";

export default function TripPage({ readOnly = false }: { readOnly?: boolean }) {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState<Capsule | null>(null);
  const [day, setDay] = useState(0);
  const [sel, setSel] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [edit, setEdit] = useState("");
  const [showBooking, setShowBooking] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.trip(id).then(setC).catch((e) => setErr(e.message));
  }, [id]);

  const update = (next: Capsule, msg?: string) => {
    setC(next);
    cacheCapsule(next);
    if (msg) setToast(msg);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setToast(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  if (err) return <div className="p-8 text-center text-red-600">{err} · <Link className="underline" to="/">home</Link></div>;
  if (!c) return <div className="grid h-full place-items-center"><Spinner className="h-8 w-8 text-brand-600" /></div>;
  const d = c.days[day];
  const v = d.verify;

  const onChoose = readOnly ? undefined : (b: Block, pid: string) =>
    run(async () => update(await api.choose(c.id, day, b.id, pid), "Swapped and re-timed. Feasibility re-checked."));
  const sendEdit = () =>
    run(async () => {
      const r = await api.edit(c.id, edit);
      update(r.capsule, [...r.messages, ...(r.changes || []).map((x) => `Day ${x.day}: ${[...x.added.map((a) => "+" + a), ...x.removed.map((a) => "−" + a)].join(", ")}`)].join(" · "));
      setEdit("");
    });

  return (
    <div className="min-h-full pb-24">
      <TopBar>
        {!readOnly && (
          <>
            <Link to={`/trip/${c.id}/capsule`} className="btn-ghost hidden px-3 sm:inline-flex"><Package className="h-4 w-4" />Capsule</Link>
            <button onClick={() => nav(`/trip/${c.id}/live`)} className="btn-accent px-3"><Radio className="h-4 w-4" />Go Live</button>
          </>
        )}
        {readOnly && <span className="chip bg-brand-50 text-brand-700">Shared trip · read-only</span>}
      </TopBar>

      <main className="mx-auto max-w-6xl px-4 py-5">
        {/* header */}
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label text-accent-600">Trip Capsule</div>
            <h1 className="text-2xl font-bold sm:text-3xl">{c.city.name}, {c.brief.days} days</h1>
            <p className="text-sm text-ink-500">
              {c.days[0].date} → {c.days[c.days.length - 1].date} · {c.travellers.map((t) => t.label).join(", ")} · stay: {c.stay.name}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.dna_summary.map((x) => <span key={x} className="chip bg-brand-50 text-brand-700">{x}</span>)}
              {c.constraints.diet !== "any" && <span className="chip bg-emerald-50 text-emerald-700">{c.constraints.diet}</span>}
              {c.constraints.no_stairs && <span className="chip bg-amber-50 text-amber-700">no steep climbs</span>}
            </div>
          </div>
          <div className="card flex items-center gap-4 px-4 py-3 text-sm">
            <div>
              <div className="text-xs text-ink-500">Planned (incl. stay)</div>
              <div className="text-lg font-bold">{rupees(c.budget.planned_total)}</div>
            </div>
            {c.budget.budget_total && (
              <span className={`chip ${c.budget.fits ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                {c.budget.fits ? "within" : "over"} {rupees(c.budget.budget_total)}
              </span>
            )}
          </div>
        </section>

        {c.notes.length > 0 && (
          <div className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">{c.notes.map((n) => <div key={n}>⚠ {n}</div>)}</div>
        )}

        {/* stay decision card */}
        {!readOnly && day === 0 && (
          <section className="mt-5">
            <div className="label mb-2">Decision card · where to stay</div>
            <div className="grid gap-2 sm:grid-cols-4">
              {c.stay_options.map((o) => {
                const active = o.id === c.stay.id;
                return (
                  <button key={o.id} disabled={busy || active}
                    onClick={() => run(async () => update(await api.stay(c.id, o.id), `Re-planned all days around ${o.name}`))}
                    className={`rounded-2xl border p-3 text-left text-sm transition ${active ? "border-brand-500 bg-brand-50" : "border-ink-100 bg-white hover:border-brand-200"}`}>
                    <div className="flex items-center justify-between font-semibold">{o.name}{o.pick && <span className="text-xs text-accent-600">★ pick</span>}</div>
                    <div className="text-xs text-ink-500">{o.price}</div>
                    <div className="mt-1 text-xs text-ink-700">~{o.avg_minutes} min to your top places</div>
                    <div className="mt-1 text-[11px] text-ink-500">{o.tradeoff}</div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* day tabs */}
        <nav className="mt-6 flex gap-2 overflow-x-auto pb-1">
          {c.days.map((x) => (
            <button key={x.index} onClick={() => setDay(x.index)}
              className={`shrink-0 rounded-2xl border px-4 py-2 text-left text-sm transition ${x.index === day ? "border-brand-600 bg-brand-600 text-white" : "border-ink-100 bg-white"}`}>
              <div className="font-semibold">Day {x.index + 1}</div>
              <div className={`text-xs ${x.index === day ? "text-brand-100" : "text-ink-500"}`}>{x.weekday} {x.date.slice(5)} · {x.verify.score}</div>
            </button>
          ))}
        </nav>

        {/* day stats */}
        <section className="card mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
          <ScoreRing score={v.score} label="feasibility" />
          <EnergyBar pct={v.energy.pct} label={`budget set by ${d.limiter}`} />
          <Stat k="Day cost" v={rupees(d.cost)} />
          <Stat k="In transit" v={`${v.travel_share}% · ${v.travel_min} min`} />
          {d.weather && <Stat k="Weather" v={`${Math.round(d.weather.tmax)}°C · ${d.weather.rain_prob}% rain`} sub={d.weather.source} />}
        </section>

        <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_420px]">
          <section>
            <Timeline day={d} onChoose={onChoose} onSelect={(b) => setSel(b.id)} selected={sel} />
          </section>
          <aside className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
            <div className="h-[320px] overflow-hidden rounded-2xl border border-ink-100 lg:h-[380px]">
              <MapView capsule={c} day={d} highlight={sel} />
            </div>
            <div className="card p-4">
              <div className="label mb-2">Time-Truth checks</div>
              <ul className="space-y-1.5 text-sm">
                {v.checks.map((ch, i) => (
                  <li key={i} className="flex gap-2">
                    {ch.level === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> :
                      ch.level === "warn" ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> :
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
                    <span>{ch.text}</span>
                  </li>
                ))}
              </ul>
            </div>
            {!readOnly && (
              <div className="card p-4">
                <div className="flex items-center justify-between">
                  <div className="label">Bookings (fixed anchors)</div>
                  <button className="text-sm font-semibold text-brand-700" onClick={() => setShowBooking(true)}><Ticket className="mr-1 inline h-4 w-4" />Add</button>
                </div>
                {c.bookings.length === 0 && <p className="mt-1 text-sm text-ink-500">Add your train/flight so the plan protects your connections.</p>}
                {c.bookings.map((b) => (
                  <div key={b.id} className="mt-2 text-sm">
                    <b className="capitalize">{b.kind}</b> · {b.mode} {b.number} · {b.date} {b.time} · {b.station_id}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      </main>

      {!readOnly && (
        <form className="fixed inset-x-0 bottom-0 z-[1500] border-t border-ink-100 bg-white/95 p-3 backdrop-blur" onSubmit={(e) => (e.preventDefault(), edit.trim() && sendEdit())}>
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <MessageSquare className="h-5 w-5 shrink-0 text-brand-600" />
            <input className="input" value={edit} onChange={(e) => setEdit(e.target.value)}
              placeholder="Tell Tripzy: 'make day 2 lighter', 'add Golconda', 'dad can't climb', 'start later'" />
            <button className="btn-primary" disabled={busy || !edit.trim()}>{busy ? <Spinner /> : <Send className="h-4 w-4" />}</button>
          </div>
        </form>
      )}
      {showBooking && <BookingModal c={c} onClose={() => setShowBooking(false)} onSaved={(x) => (update(x, "Booking anchored. Plan re-built around it."), setShowBooking(false))} />}
      {toast && <Toast text={toast} onClose={() => setToast("")} />}
    </div>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{k}</div>
      <div className="font-semibold">{v}</div>
      {sub && <div className="text-[10px] text-ink-500">{sub}</div>}
    </div>
  );
}

function BookingModal({ c, onClose, onSaved }: { c: Capsule; onClose: () => void; onSaved: (c: Capsule) => void }) {
  const [f, setF] = useState({ kind: "arrival", mode: "train", number: "", date: c.days[0].date, time: "07:30", station_id: c.city.stations[0].id, pnr: "" });
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const autofill = async () => {
    const r = await api.parseTicket(paste, c.city_key);
    setF({ ...f, ...r });
  };
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      onSaved(await api.booking(c.id, f));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[3000] flex items-end justify-center bg-ink-900/40 p-3 sm:items-center">
      <div className="animate-pop w-full max-w-md rounded-3xl bg-white p-5">
        <h3 className="text-lg font-bold">Add a booking</h3>
        <p className="text-sm text-ink-500">Fixed anchors the plan must respect. Paste your ticket confirmation to autofill.</p>
        <textarea className="input mt-3 h-20" placeholder="PNR: 4521378890 Train No: 12723 … Arr 07:30 HYB" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <button className="btn-ghost mt-2 w-full" disabled={!paste.trim()} onClick={autofill}>Autofill from text</button>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <select className="input" value={f.kind} onChange={(e) => set("kind", e.target.value)}><option value="arrival">Arrival</option><option value="departure">Departure</option></select>
          <select className="input" value={f.mode} onChange={(e) => set("mode", e.target.value)}><option value="train">Train</option><option value="flight">Flight</option><option value="bus">Bus</option></select>
          <input className="input" placeholder="Train/flight no" value={f.number} onChange={(e) => set("number", e.target.value)} />
          <select className="input" value={f.station_id} onChange={(e) => set("station_id", e.target.value)}>
            {c.city.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="input" value={f.date} onChange={(e) => set("date", e.target.value)}>
            {c.days.map((d) => <option key={d.date} value={d.date}>{d.date}</option>)}
          </select>
          <input className="input" type="time" value={f.time} onChange={(e) => set("time", e.target.value)} />
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>{busy && <Spinner />}Anchor it</button>
        </div>
      </div>
    </div>
  );
}
