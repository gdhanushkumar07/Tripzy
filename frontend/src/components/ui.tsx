import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Plane } from "lucide-react";

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2 font-bold text-ink-900">
      <span className={`grid place-items-center rounded-xl bg-brand-600 text-white ${small ? "h-7 w-7" : "h-9 w-9"}`}>
        <Plane className={small ? "h-4 w-4" : "h-5 w-5"} />
      </span>
      <span className={small ? "text-lg" : "text-xl"}>
        Trip<span className="text-accent-500">zy</span>
      </span>
    </Link>
  );
}

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-[1000] border-b border-ink-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Logo small />
        <div className="flex min-w-0 items-center gap-2">{children}</div>
      </div>
    </header>
  );
}

export function ScoreRing({ score, size = 52, label = "feasible" }: { score: number; size?: number; label?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 85 ? "#16a34a" : score >= 70 ? "#d97706" : "#dc2626";
  return (
    <div className="flex items-center gap-2" title={`Feasibility ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#e9eaf1" strokeWidth="6" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="6" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="rotate-90 origin-center"
          style={{ fontSize: size / 3.6, fontWeight: 700, fill: "#121527" }}>{score}</text>
      </svg>
      {label && <span className="text-xs leading-tight text-ink-500">{label}</span>}
    </div>
  );
}

export function EnergyBar({ pct, label }: { pct: number; label?: string }) {
  const color = pct > 100 ? "bg-red-500" : pct > 85 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="min-w-[120px]">
      <div className="mb-1 flex justify-between text-xs text-ink-500">
        <span>⚡ Energy</span>
        <span className="font-semibold text-ink-700">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-100">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {label && <div className="mt-1 text-[11px] text-ink-500">{label}</div>}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-[2000] flex justify-center px-4">
      <div className="animate-pop flex max-w-md items-start gap-3 rounded-2xl bg-ink-900 px-4 py-3 text-sm text-white shadow-lg">
        <span className="flex-1">{text}</span>
        <button onClick={onClose} className="text-ink-300 hover:text-white">✕</button>
      </div>
    </div>
  );
}
