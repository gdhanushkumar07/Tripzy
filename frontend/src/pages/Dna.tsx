import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import { useDraft } from "../lib/store";
import type { Brief } from "../lib/types";
import { TopBar } from "../components/ui";

type Card = Awaited<ReturnType<typeof api.cards>>[number];

export default function Dna() {
  const nav = useNavigate();
  const { brief, swipes, swipe, patchBrief } = useDraft();
  const [cards, setCards] = useState<Card[]>([]);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!brief) nav("/");
    api.cards().then(setCards).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const card = cards[i];
  const pick = (c: "a" | "b") => {
    if (!card) return;
    swipe(card.id, c);
    setI((x) => x + 1);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") pick("a");
      if (e.key === "ArrowRight") pick("b");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (!brief) return null;
  const done = cards.length > 0 && i >= cards.length;
  const ready = brief.city && brief.start_date;

  return (
    <div className="min-h-full">
      <TopBar><span className="text-sm text-ink-500">Step 1 of 2 · Trip DNA</span></TopBar>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[380px_1fr]">
        <BriefCard brief={brief} patch={patchBrief} />

        <section className="card flex flex-col p-5 sm:p-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="label text-accent-600">60-second Trip DNA</div>
              <h2 className="text-2xl font-bold">Which sounds more like your trip?</h2>
            </div>
            <span className="text-sm font-semibold text-ink-500">{Math.min(i, cards.length)}/{cards.length}</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full bg-accent-500 transition-all" style={{ width: `${cards.length ? (Math.min(i, cards.length) / cards.length) * 100 : 0}%` }} />
          </div>

          {!done && card && (
            <div key={card.id} className="animate-pop mt-8 grid flex-1 grid-cols-2 gap-3 sm:gap-5">
              {(["a", "b"] as const).map((k) => (
                <button key={k} onClick={() => pick(k)}
                  className={`group flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-3xl border-2 p-4 text-center transition hover:-translate-y-1 hover:shadow-card ${k === "a" ? "border-brand-100 bg-gradient-to-br from-brand-50 to-white hover:border-brand-500" : "border-accent-100 bg-gradient-to-br from-accent-50 to-white hover:border-accent-500"}`}>
                  <span className="text-6xl transition group-hover:scale-110">{card[k].emoji}</span>
                  <span className="text-base font-semibold sm:text-lg">{card[k].label}</span>
                  <span className="text-xs text-ink-500">{k === "a" ? "← key" : "→ key"}</span>
                </button>
              ))}
            </div>
          )}
          {!done && card && (
            <div className="mt-4 flex justify-between text-sm">
              <button className="text-ink-500 disabled:opacity-30" disabled={i === 0} onClick={() => setI(i - 1)}><ArrowLeft className="inline h-4 w-4" /> back</button>
              <button className="text-ink-500" onClick={() => setI(cards.length)}>skip the rest</button>
            </div>
          )}
          {done && (
            <div className="animate-pop mt-8 flex flex-1 flex-col items-center justify-center text-center">
              <span className="text-5xl">🧬</span>
              <h3 className="mt-3 text-xl font-bold">Your Trip DNA is ready</h3>
              <p className="mt-1 max-w-sm text-sm text-ink-500">{Object.keys(swipes).length} choices captured. Tripzy will keep learning from your reactions during the trip.</p>
              <button className="btn-accent mt-6 px-6 py-3 text-base" disabled={!ready} onClick={() => nav("/compose")}>
                <Wand2 className="h-5 w-5" /> Build my trip
              </button>
              {!ready && <p className="mt-2 text-sm text-red-600">Pick a city and start date on the left first.</p>}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function BriefCard({ brief, patch }: { brief: Brief; patch: (p: Partial<Brief>) => void }) {
  return (
    <aside className="card h-fit p-5">
      <div className="label">Your trip brief</div>
      <p className="mt-1 text-sm italic text-ink-500">"{brief.raw}"</p>
      {brief.parsed_by === "claude" && <span className="chip mt-1 bg-brand-50 text-brand-700">parsed by Claude</span>}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="City">
          <select className="input" value={brief.city ?? ""} onChange={(e) => patch({ city: e.target.value || null })}>
            <option value="">Choose…</option>
            <option value="hyderabad">Hyderabad</option>
            <option value="jaipur">Jaipur</option>
          </select>
        </Field>
        <Field label="Start">
          <input type="date" className="input" value={brief.start_date} onChange={(e) => patch({ start_date: e.target.value })} />
        </Field>
        <Field label="Days">
          <input type="number" min={1} max={7} className="input" value={brief.days} onChange={(e) => patch({ days: Math.max(1, Math.min(7, +e.target.value)) })} />
        </Field>
        <Field label="Who">
          <select className="input" value={brief.party} onChange={(e) => patch({ party: e.target.value as Brief["party"] })}>
            <option value="solo">Solo</option>
            <option value="couple">Couple</option>
            <option value="friends">Friends</option>
            <option value="family">Family + kids</option>
            <option value="parents">With parents</option>
          </select>
        </Field>
        <Field label="Food">
          <select className="input" value={brief.diet} onChange={(e) => patch({ diet: e.target.value as Brief["diet"] })}>
            <option value="any">Anything</option>
            <option value="veg">Veg</option>
            <option value="jain">Jain</option>
            <option value="halal">Halal</option>
          </select>
        </Field>
        <Field label="Budget (₹)">
          <input type="number" className="input" placeholder="optional" value={brief.budget_total ?? ""}
            onChange={(e) => patch({ budget_total: e.target.value ? +e.target.value : null })} />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={brief.no_stairs} onChange={(e) => patch({ no_stairs: e.target.checked })} className="h-4 w-4 accent-brand-600" />
        Avoid steep climbs / stairs
      </label>
      {brief.assumptions.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-700">
          {brief.assumptions.map((a) => <li key={a}>• {a}</li>)}
        </ul>
      )}
      {brief.interests.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">{brief.interests.map((x) => <span key={x} className="chip bg-brand-50 text-brand-700">{x}</span>)}</div>
      )}
      <p className="mt-4 flex items-center gap-1 text-xs text-ink-500"><ArrowRight className="h-3 w-3" />Swipe on the right, then Tripzy builds the full plan.</p>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
