import { Loader2, LocateFixed, MapPin } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { api, type GeoPoint } from '../lib/api'
import { currentPosition, shouldAutoLocate } from '../lib/location'
import { toFriendly } from '../lib/request'

/**
 * Search any place in the world (Ola Maps / OpenStreetMap through the API server), biased to
 * where you are, with keyboard support and "use my location" (auto-filled once when autoLocate).
 */
export function LocationInput({ label, value, onChange, placeholder = 'Search any place, station or airport', near, disabled, allowLocate = true, autoLocate = false }: {
  label: string; value: GeoPoint | null; onChange: (p: GeoPoint | null) => void; placeholder?: string
  near?: { lat: number; lon: number } | null; disabled?: boolean; allowLocate?: boolean; autoLocate?: boolean
}) {
  const id = useId()
  const [text, setText] = useState(value?.name ?? '')
  const [items, setItems] = useState<GeoPoint[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const shown = value?.name ?? ''
  const [lastShown, setLastShown] = useState(shown)
  if (shown !== lastShown) { setLastShown(shown); setText(shown) }

  useEffect(() => () => clearTimeout(timer.current), [])

  const search = (q: string) => {
    setText(q)
    setErr('')
    clearTimeout(timer.current)
    if (q.trim().length < 2) { setItems([]); return }
    timer.current = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await api.geocode(q.trim(), near ?? undefined)
        setItems(r)
        setOpen(true)
        setActive(0)
        if (!r.length) setErr('No place found with that name.')
      } catch (e) {
        setErr(toFriendly(e).message)
      } finally {
        setBusy(false)
      }
    }, 280)
  }

  const pick = (p: GeoPoint) => {
    onChange(p)
    setText(p.name)
    setOpen(false)
  }

  const locate = () => {
    setBusy(true)
    currentPosition().then(pick, (e: Error) => setErr(e.message)).finally(() => setBusy(false))
  }
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })
  // live location as the default start, once per session, only while the field is empty
  const auto = useRef({ value, autoLocate, disabled })
  useEffect(() => {
    const a = auto.current
    if (!a.autoLocate || a.value || a.disabled) return
    let off = false
    void shouldAutoLocate().then((ok) => {
      if (ok && !off) currentPosition().then((p) => { if (!off) { onChangeRef.current(p); setText(p.name) } }, () => undefined)
    })
    return () => { off = true }
  }, [])

  return (
    <div className="relative">
      <label className="label" htmlFor={id}>{label}</label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" />
        <input
          id={id} className="tz-input !pl-10 !pr-20" value={text} placeholder={placeholder} disabled={disabled} autoComplete="off"
          role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
          onChange={(e) => { search(e.target.value); if (value && e.target.value !== value.name) onChange(null) }}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !items.length) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
            if (e.key === 'Enter') { e.preventDefault(); pick(items[active]) }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-content-faint" aria-label="Searching" />}
          {allowLocate && !disabled && (
            <button type="button" onClick={locate} title="Use my location" aria-label="Use my location" className="grid h-8 w-8 place-items-center rounded-full text-content-muted hover:bg-surface-hover hover:text-content">
              <LocateFixed className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {open && items.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="tz-rise absolute z-[600] mt-1 max-h-72 w-full overflow-auto rounded-2xl border border-edge bg-surface-card p-1 shadow-dropdown">
          {items.map((p, i) => (
            <li key={`${p.lat},${p.lon},${i}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}
                className={`block w-full rounded-xl px-3 py-2 text-start ${i === active ? 'bg-accent-subtle' : 'hover:bg-surface-hover'}`}>
                <span className="block text-body font-medium text-content">{p.name}</span>
                {p.label && p.label !== p.name && <span className="block truncate text-caption text-content-muted">{p.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="field-error">{err}</p>}
    </div>
  )
}
