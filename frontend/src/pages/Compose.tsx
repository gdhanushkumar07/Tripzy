import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { composeStream } from "../lib/api";
import { useDraft } from "../lib/store";
import type { Step } from "../lib/types";
import { Spinner, TopBar } from "../components/ui";

const ORDER = ["Brief Agent", "Profile Agent", "Live Watcher", "Discovery Agent", "Route Agent", "Planner Agent", "Shadow Agent", "Time-Truth Agent", "Capsule Agent"];

export default function Compose() {
  const nav = useNavigate();
  const { brief, swipes } = useDraft();
  const [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (!brief) return nav("/");
    if (started.current) return;
    started.current = true;
    composeStream({ brief, swipes }, (s) => setSteps((x) => [...x, s]))
      .then((id) => setTimeout(() => nav(`/trip/${id}`), 900))
      .catch((e) => setErr(String(e.message)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const next = ORDER[steps.length];
  return (
    <div className="min-h-full">
      <TopBar><span className="text-sm text-ink-500">Step 2 of 2 · Building</span></TopBar>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="label text-accent-600">Tripzy agents at work</div>
        <h1 className="text-2xl font-bold">Composing your Trip Capsule</h1>
        <ol className="mt-6 space-y-3">
          {steps.map((s) => (
            <li key={s.node} className="card animate-pop flex gap-3 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{s.agent}</div>
                <div className="font-semibold">{s.title}</div>
                <div className="text-sm text-ink-700">{s.detail}</div>
              </div>
            </li>
          ))}
          {next && !err && (
            <li className="flex items-center gap-3 rounded-2xl border border-dashed border-ink-300 p-4 text-ink-500">
              <Spinner className="text-brand-600" /> {next} working…
            </li>
          )}
        </ol>
        {err && (
          <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            {err} <button className="ml-2 underline" onClick={() => nav("/dna")}>Go back</button>
          </div>
        )}
      </main>
    </div>
  );
}
