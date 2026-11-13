import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { Brain, Copy, History, Phone, RefreshCw, Share2, ShieldAlert } from "lucide-react";
import { api, cacheCapsule, rupees } from "../lib/api";
import type { Capsule } from "../lib/types";
import { Spinner, Toast, TopBar } from "../components/ui";

export default function CapsulePage() {
  const { id = "" } = useParams();
  const [c, setC] = useState<Capsule | null>(null);
  const [qr, setQr] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const shareUrl = `${window.location.origin}/share/${id}`;

  useEffect(() => {
    api.trip(id).then(setC);
    QRCode.toDataURL(shareUrl, { margin: 1, width: 180, color: { dark: "#121527" } }).then(setQr).catch(() => undefined);
  }, [id, shareUrl]);

  if (!c) return <div className="grid h-full place-items-center"><Spinner className="h-8 w-8 text-brand-600" /></div>;
  const places = c.days.flatMap((d) => d.blocks.filter((b) => b.kind === "place"));
  const km = c.days.flatMap((d) => d.blocks.filter((b) => b.kind === "leg")).reduce((a, b) => a + (b.km || 0), 0);
  const loved = places.filter((b) => b.feedback === "loved");
  const dnaShift = Object.entries(c.dna.interests)
    .map(([k, v]) => [k, v - (c.dna_initial.interests[k] ?? v)] as const)
    .filter(([, dv]) => Math.abs(dv) >= 0.04);

  const retune = async () => {
    setBusy(true);
    const from = c.ripple_log.length ? Math.max(...c.ripple_log.map((r) => r.day)) + 1 : 1;
    const x = await api.retune(c.id, Math.min(from, c.days.length - 1));
    setC(x);
    cacheCapsule(x);
    setBusy(false);
    setToast(`Re-tuned Day ${Math.min(from, c.days.length - 1) + 1} onward with your updated DNA`);
  };

  return (
    <div className="min-h-full pb-12">
      <TopBar><Link to={`/trip/${c.id}`} className="btn-ghost px-3">Plan</Link><Link to={`/trip/${c.id}/live`} className="btn-accent px-3">Live</Link></TopBar>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <section className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand-600 via-brand-700 to-accent-600 p-6 text-white">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-100">Trip Capsule · one package</div>
            <h1 className="mt-1 text-3xl font-bold">{c.city.name}</h1>
            <p className="text-brand-100">{c.days[0].date} → {c.days[c.days.length - 1].date} · {c.travellers.length} travellers · stay {c.stay.name}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Big k="Places" v={String(places.length)} />
              <Big k="Km planned" v={km.toFixed(0)} />
              <Big k="Planned spend" v={rupees(c.budget.planned_total)} />
              <Big k="Re-plans handled" v={String(c.ripple_log.length)} />
            </div>
          </div>
        </section>

        <div className="grid gap-5 md:grid-cols-2">
          <section className="card p-5">
            <div className="label mb-3 flex items-center gap-1"><Share2 className="h-3.5 w-3.5" />Share with family</div>
            <div className="flex items-center gap-4">
              {qr && <img src={qr} alt="QR code for shared trip" className="h-32 w-32 rounded-xl border border-ink-100" />}
              <div className="min-w-0 text-sm">
                <p className="text-ink-500">Read-only live itinerary. Family sees every re-plan.</p>
                <button className="btn-ghost mt-2" onClick={() => navigator.clipboard?.writeText(shareUrl).then(() => setToast("Link copied"))}>
                  <Copy className="h-4 w-4" />Copy link
                </button>
              </div>
            </div>
          </section>

          <section className="card p-5">
            <div className="label mb-3 flex items-center gap-1 text-red-600"><ShieldAlert className="h-3.5 w-3.5" />SOS card</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(c.city.emergency).map(([k, v]) => (
                <a key={k} href={`tel:${v}`} className="flex items-center justify-between rounded-xl bg-red-50 px-3 py-2 text-red-700">
                  <span className="capitalize">{k.replace("_", " ")}</span><b className="flex items-center gap-1"><Phone className="h-3 w-3" />{v}</b>
                </a>
              ))}
            </div>
            <p className="mt-3 text-sm"><b>Stay area:</b> {c.stay.name}</p>
            <p className="text-sm text-ink-500">{c.city.local_phrase}</p>
          </section>
        </div>

        <section className="card p-5">
          <div className="flex items-center justify-between">
            <div className="label flex items-center gap-1"><Brain className="h-3.5 w-3.5" />What Tripzy learned about you</div>
            <button className="btn-ghost" disabled={busy || !c.learned.length} onClick={retune}>{busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />}Re-tune upcoming days</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">{c.dna_summary.map((x) => <span key={x} className="chip bg-brand-50 text-brand-700">{x}</span>)}</div>
          {dnaShift.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {dnaShift.map(([k, dv]) => (
                <span key={k} className={`chip ${dv > 0 ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-700"}`}>{k} {dv > 0 ? "▲" : "▼"} {Math.abs(dv * 100).toFixed(0)}</span>
              ))}
            </div>
          )}
          <ul className="mt-3 space-y-1 text-sm">
            {c.learned.length === 0 && <li className="text-ink-500">Rate places in Live mode (❤️ 👍 👎) and Tripzy adapts the rest of your trip.</li>}
            {c.learned.map((l, i) => <li key={i}>• Day {l.day}, after <b>{l.from}</b>: {l.text}</li>)}
          </ul>
          {loved.length > 0 && <p className="mt-2 text-sm">❤️ Highlights: {loved.map((b) => b.name).join(", ")}</p>}
        </section>

        <section className="card p-5">
          <div className="label mb-3 flex items-center gap-1"><History className="h-3.5 w-3.5" />Ripple log: how the trip adapted</div>
          {c.ripple_log.length === 0 && <p className="text-sm text-ink-500">No disruptions yet.</p>}
          <ol className="space-y-2 text-sm">
            {c.ripple_log.map((r) => (
              <li key={r.id} className="rounded-xl bg-ink-50 p-3">
                <b>Day {r.day + 1} · {r.now}</b> · {r.diff.headline} {r.auto && <span className="chip bg-white text-ink-500">auto</span>}
                <div className="text-ink-500">
                  {[...r.diff.swapped.map((s) => `${s.from} → ${s.to}`), ...r.diff.moved.map((m) => `${m.name} → Day ${m.to_day}`),
                    ...r.diff.dropped.map((m) => `dropped ${m.name}`), ...r.diff.inserted.map((x) => `+ ${x}`),
                    r.diff.shifted.length ? `${r.diff.shifted.length} stops re-timed` : ""].filter(Boolean).join(" · ")}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="card p-5">
          <div className="label mb-2">Bookings & budget</div>
          {c.bookings.map((b) => <div key={b.id} className="text-sm"><b className="capitalize">{b.kind}</b> {b.mode} {b.number} · {b.date} {b.time} · {b.station_id}{b.pnr ? ` · PNR ${b.pnr}` : ""}</div>)}
          {c.bookings.length === 0 && <p className="text-sm text-ink-500">No bookings yet. Add them from the plan page.</p>}
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div><div className="text-ink-500">Planned</div><b>{rupees(c.budget.planned_total)}</b></div>
            <div><div className="text-ink-500">Stay estimate</div><b>{rupees(c.budget.stay_estimate)}</b></div>
            <div><div className="text-ink-500">Spent so far</div><b>{rupees(c.budget.spent_total)}</b></div>
          </div>
        </section>
      </main>
      {toast && <Toast text={toast} onClose={() => setToast("")} />}
    </div>
  );
}

function Big({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-3">
      <div className="text-xs text-brand-100">{k}</div>
      <div className="text-xl font-bold">{v}</div>
    </div>
  );
}
