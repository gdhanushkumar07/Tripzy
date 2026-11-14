import React, { useEffect, useState } from 'react'
import { Activity, CheckCircle2, CircleDashed, FlaskConical, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { PublicPage } from '../../tripzy/PublicLayout'
import { engine, type ProviderRow } from '../../tripzy/engine'

/** /status: live health of every data provider Tripzy depends on. */
export function StatusPage(): React.ReactElement {
  const [data, setData] = useState<{ checked_at: string; providers: ProviderRow[] } | null>(null)
  const [err, setErr] = useState('')
  const load = () => {
    setErr('')
    setData(null)
    engine.providers().then(setData).catch((e) => setErr(e.message))
  }
  useEffect(load, [])
  const badge: Record<ProviderRow['status'], [React.ElementType, string, string]> = {
    ok: [CheckCircle2, 'Operational', 'bg-success-soft text-success'],
    degraded: [Activity, 'Degraded', 'bg-warning-soft text-warning'],
    down: [XCircle, 'Unavailable', 'bg-danger-soft text-danger'],
    not_configured: [CircleDashed, 'Not configured', 'bg-surface-secondary text-content-muted'],
    simulated: [FlaskConical, 'Simulated', 'tz-coral-pill'],
  }
  return (
    <PublicPage>
      <div className="mx-auto max-w-4xl px-5 py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-caption font-semibold uppercase tracking-wider tz-coral-text">Service status</div>
            <h1 className="mt-1 text-[32px] font-bold text-content">Data providers</h1>
            <p className="mt-1 text-body text-content-muted">Checked live by the Tripzy engine. Anything simulated is labelled as simulated everywhere it appears.</p>
          </div>
          <button type="button" onClick={load} className="inline-flex h-10 items-center gap-2 rounded-xl border border-edge bg-surface-card px-4 text-body font-semibold text-content hover:bg-surface-hover"><RefreshCw className="h-4 w-4" />Re-check</button>
        </div>
        {err && <div className="mt-6 rounded-2xl bg-danger-soft p-4 text-body text-danger">The Tripzy engine is unreachable: {err}</div>}
        {!data && !err && <div className="mt-10 grid place-items-center"><Loader2 className="h-7 w-7 animate-spin text-accent-on" /></div>}
        {data && (
          <div className="mt-8 overflow-hidden rounded-3xl border border-edge bg-surface-card">
            {data.providers.map((p) => {
              const [I, label, cls] = badge[p.status]
              return (
                <div key={p.name} className="flex flex-wrap items-start gap-4 border-b border-edge p-5 last:border-0">
                  <div className="min-w-[220px] flex-1">
                    <div className="font-semibold text-content">{p.name}</div>
                    <div className="text-caption text-content-muted">{p.purpose}</div>
                    <div className="mt-1 text-caption text-content-faint">{p.detail}{p.latency_ms ? ` · ${p.latency_ms} ms` : ''} · {p.attribution}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-semibold ${cls}`}><I className="h-3.5 w-3.5" />{label}</span>
                </div>
              )
            })}
          </div>
        )}
        {data && <p className="mt-3 text-caption text-content-faint">Last checked {data.checked_at} (cached for 60 s)</p>}
      </div>
    </PublicPage>
  )
}

function Legal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <PublicPage>
      <article className="mx-auto max-w-3xl px-5 py-14 text-[15px] leading-relaxed text-content-secondary [&_h2]:mt-8 [&_h2]:text-subtitle [&_h2]:font-semibold [&_h2]:text-content [&_p]:mt-3">
        <div className="text-caption font-semibold uppercase tracking-wider tz-coral-text">Tripzy</div>
        <h1 className="mt-1 text-[32px] font-bold text-content">{title}</h1>
        <p className="text-caption text-content-faint">Last updated 14 November 2026</p>
        {children}
      </article>
    </PublicPage>
  )
}

export function PrivacyPage(): React.ReactElement {
  return (
    <Legal title="Privacy">
      <h2>What we store</h2>
      <p>Your account (name, email, a hashed password or your Google identity), the trips you save, your Travel DNA answers, bookings and documents you add, expenses, and your reactions to places. All of it belongs to your account and is only visible to you and people you explicitly invite to a trip.</p>
      <h2>Planning without an account</h2>
      <p>Drafts planned before signing in are stored under a random identifier. When you sign in and save, the draft becomes yours and is no longer readable by anyone else.</p>
      <h2>Location</h2>
      <p>The Live Companion only reads your location when you press “Use my location”, and does not store it.</p>
      <h2>Third parties</h2>
      <p>Route, weather and photo lookups are made by our server to OpenStreetMap/OSRM, Open-Meteo and Wikipedia with place coordinates only, never your identity. Optional language understanding uses Anthropic's API when configured.</p>
      <h2>Your control</h2>
      <p>You can edit your Travel DNA at any time, delete trips and documents, and delete your account from Settings.</p>
    </Legal>
  )
}

export function TermsPage(): React.ReactElement {
  return (
    <Legal title="Terms">
      <h2>Planning assistance</h2>
      <p>Tripzy helps you plan. Opening hours, prices and travel times come from the sources shown in the app and can change. Always confirm critical details (tickets, closures, train times) with the operator before you travel.</p>
      <h2>Simulated data</h2>
      <p>Features marked “simulated” or “demo” (for example train running status and the Test Lab) use generated data to demonstrate behaviour and are not live information.</p>
      <h2>Bookings</h2>
      <p>Tripzy does not sell tickets or take payments. Links to booking providers take you to their own sites and terms.</p>
      <h2>Open source</h2>
      <p>Tripzy is built on the TREK platform, licensed AGPL-3.0. The source code of this service is available on request.</p>
    </Legal>
  )
}
