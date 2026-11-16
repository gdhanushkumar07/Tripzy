/**
 * "Most visited in <city>": the places most visitors come for, shown above the plan whether or not
 * the answers picked them. Each says where it is in the plan, or why it isn't, and can be added to
 * a day or swapped in for one of that day's stops.
 */
import { Check, MapPin, Plus, Repeat } from 'lucide-react'
import { useState } from 'react'
import { PlaceImage } from '../ui/kit'
import { addStop, swapStop, topSights, type Trip } from './generate'

const dayLabel = (trip: Trip, i: number) => `Day ${i + 1} · ${new Date(`${trip.days[i].date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`

export function TopSights({ trip, onEdit }: { trip: Trip; onEdit: (next: Trip, msg: string) => void }) {
  const sights = topSights(trip)
  const [open, setOpen] = useState<string | null>(null)
  const [day, setDay] = useState(0)
  const [all, setAll] = useState(false)
  if (!sights.length) return null
  const city = trip.center?.name ?? trip.title.split(',')[0]
  // collapsed: the six best known, plus every one that is not in the plan yet (those are the ones to act on)
  const shown = all ? sights : sights.filter((s, i) => i < 6 || s.day === null)
  const inPlan = sights.filter((s) => s.day !== null).length

  return (
    <section className="mt-8 space-y-4" aria-label={`Most visited in ${city}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="tz-kicker"><MapPin className="me-1 inline h-4 w-4" />Most visited in {city}</div>
          <p className="mt-1 text-body text-content-muted">The places most visitors come for. {inPlan} of {sights.length} are in your plan; add or swap in any of the others.</p>
        </div>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map(({ place: p, day: d, why }) => (
          <li key={p.id} className="overflow-hidden rounded-2xl border border-edge bg-surface-card">
            <div className="flex gap-3 p-3">
              {p.image
                ? <img src={p.image} alt={p.name} loading="lazy" className="h-16 w-20 shrink-0 rounded-xl object-cover" />
                : <PlaceImage id={p.id} cat={p.cat} alt={p.name} className="h-16 w-20 shrink-0 rounded-xl" />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight text-content">{p.name}</p>
                {d !== null
                  ? <a href={`#day-${d + 1}`} className="mt-1 inline-flex items-center gap-1 text-caption font-semibold text-success hover:underline"><Check className="h-3.5 w-3.5" />In your plan · Day {d + 1}</a>
                  : <p className="mt-1 text-caption text-content-muted">{why}</p>}
              </div>
            </div>
            {d === null && (
              <div className="border-t border-edge px-3 py-2">
                {open !== p.id ? (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => { setOpen(p.id); setDay(0) }}><Plus className="h-3.5 w-3.5" />Add or swap in</button>
                ) : (
                  <div className="space-y-2">
                    <label className="label" htmlFor={`day-${p.id}`}>Which day?</label>
                    <select id={`day-${p.id}`} className="tz-input !h-10" value={day} onChange={(e) => setDay(Number(e.target.value))}>
                      {trip.days.map((_, i) => <option key={i} value={i}>{dayLabel(trip, i)} · {trip.days[i].stops.filter((s) => s.kind === 'visit').length} places</option>)}
                    </select>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" className="btn btn-sm" onClick={() => { setOpen(null); onEdit(addStop(trip, day, p), `Added ${p.name} to day ${day + 1}`) }}><Plus className="h-3.5 w-3.5" />Add to day {day + 1}</button>
                      <button type="button" className="btn-link text-caption" onClick={() => setOpen(null)}>Cancel</button>
                    </div>
                    {trip.days[day].stops.some((s) => s.kind === 'visit') && (
                      <div>
                        <p className="text-caption text-content-muted">Or swap it for:</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {trip.days[day].stops.map((s, si) => s.kind !== 'visit' ? null : (
                            <button key={`${s.placeId}-${si}`} type="button" className="chip chip-off !py-1 text-caption"
                              onClick={() => { setOpen(null); onEdit(swapStop(trip, day, si, p), `Swapped ${s.name} for ${p.name}`) }}>
                              <Repeat className="me-1 inline h-3 w-3" />{s.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {(all || shown.length < sights.length) && <button type="button" className="btn-link text-caption" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${sights.length}`}</button>}
    </section>
  )
}
