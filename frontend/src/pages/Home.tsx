import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CloudRain, Gauge, Route, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { api, lastTripId } from "../lib/api";
import { useDraft } from "../lib/store";
import { Logo, Spinner } from "../components/ui";

const EXAMPLES = [
  "Hyderabad, 3 days, with my parents, veg, Dec 18",
  "Jaipur weekend with friends, love forts and photography, budget",
  "Hyderabad 2 days with 2 kids, biryani + museums",
];

const PILLARS = [
  { icon: <Route className="h-5 w-5" />, t: "Smart routes", d: "Real road times (OpenStreetMap), door-to-door legs with traffic buffers" },
  { icon: <ShieldCheck className="h-5 w-5" />, t: "Time-Truth check", d: "Every stop is verified against hours, weekly closures and best time of day" },
  { icon: <Zap className="h-5 w-5" />, t: "Energy-aware", d: "No day is planned beyond what your group can handle" },
  { icon: <CloudRain className="h-5 w-5" />, t: "Plan B built in", d: "Rain, crowd and tired versions are ready before you leave" },
  { icon: <Gauge className="h-5 w-5" />, t: "Live re-planning", d: "A train delay ripples through the rest of your day in one tap" },
  { icon: <Sparkles className="h-5 w-5" />, t: "Learns you", d: "Your reactions tune the rest of the trip, and the next one" },
];

export default function Home() {
  const nav = useNavigate();
  const setBrief = useDraft((s) => s.setBrief);
  const resetSwipes = useDraft((s) => s.resetSwipes);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const last = lastTripId();

  const go = async (t = text) => {
    if (!t.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const b = await api.parseBrief(t);
      setBrief(b);
      resetSwipes();
      nav("/dna");
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-brand-50 via-white to-ink-50">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Logo />
        {last && <button className="btn-ghost" onClick={() => nav(`/trip/${last}`)}>My last trip</button>}
      </div>

      <section className="mx-auto max-w-3xl px-4 pb-10 pt-8 text-center sm:pt-16">
        <span className="chip bg-accent-50 text-accent-600">One tourist · one package · a better trip</span>
        <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          Plans your trip.<br />
          <span className="text-brand-600">Guards your travel.</span> Tunes your experience.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-ink-500">
          Describe your trip in one sentence. Tripzy builds a plan that checks opening hours and real travel times,
          fits how much energy your group has, and re-plans itself when the trip changes.
        </p>

        <form className="card mx-auto mt-8 flex flex-col gap-2 p-2 sm:flex-row" onSubmit={(e) => (e.preventDefault(), go())}>
          <input autoFocus className="flex-1 rounded-xl px-4 py-3 text-base outline-none" value={text}
            onChange={(e) => setText(e.target.value)} placeholder="e.g. Hyderabad, 3 days, with my parents, veg, Dec 18" />
          <button className="btn-accent py-3" disabled={busy || !text.trim()}>
            {busy ? <Spinner /> : <ArrowRight className="h-4 w-4" />} Plan it
          </button>
        </form>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} className="chip border border-ink-100 bg-white text-ink-700 hover:border-brand-500" onClick={() => (setText(e), go(e))}>
              {e}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-500">V1 cities: Hyderabad · Jaipur. No signup needed.</p>
      </section>

      <section className="mx-auto grid max-w-6xl gap-3 px-4 pb-16 sm:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((p) => (
          <div key={p.t} className="card flex gap-3 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{p.icon}</span>
            <div>
              <h3 className="font-semibold">{p.t}</h3>
              <p className="text-sm text-ink-500">{p.d}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
