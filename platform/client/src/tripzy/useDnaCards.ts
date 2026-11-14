import { useCallback, useEffect, useState } from 'react'
import { engine, type DnaCard } from './engine'

/**
 * The Travel DNA questions (12 either/or cards) come from the engine, which also
 * owns their scoring. Loaded once per session and shared by onboarding and the
 * planner. A failure is surfaced (with retry) instead of rendering an empty step.
 */
let cache: DnaCard[] | null = null
let inflight: Promise<DnaCard[]> | null = null

function load(): Promise<DnaCard[]> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = engine.cards()
      .then((c) => {
        if (!Array.isArray(c) || c.length === 0) throw new Error('No Travel DNA questions were returned')
        cache = c
        return c
      })
      .finally(() => { inflight = null })
  }
  return inflight
}

export type DnaCardsState = { cards: DnaCard[]; status: 'loading' | 'ready' | 'error'; error: string; retry: () => void }

export function useDnaCards(): DnaCardsState {
  const [cards, setCards] = useState<DnaCard[]>(cache ?? [])
  const [status, setStatus] = useState<DnaCardsState['status']>(cache ? 'ready' : 'loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (cache) return
    let alive = true
    setStatus('loading')
    load()
      .then((c) => { if (alive) { setCards(c); setStatus('ready') } })
      .catch((e: Error) => { if (alive) { setError(e.message || 'Could not load the questions'); setStatus('error') } })
    return () => { alive = false }
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { cards, status, error, retry }
}
