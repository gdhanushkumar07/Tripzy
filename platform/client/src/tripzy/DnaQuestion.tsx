import React, { useEffect } from 'react'
import { ArrowLeft, Check, RefreshCw } from 'lucide-react'
import type { DnaCard } from './engine'
import type { DnaCardsState } from './useDnaCards'

/**
 * One Travel DNA either/or question. The chosen side stays highlighted when the
 * traveller comes back to it (choosing it again confirms and moves on); "Clear
 * answer" removes it.
 */
export function DnaQuestion({ card, value, onAnswer, index, total }: {
  card: DnaCard; value?: string; onAnswer: (v: 'a' | 'b' | null) => void; index: number; total: number
}): React.ReactElement {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return
      if (e.key === 'ArrowLeft') onAnswer('a')
      if (e.key === 'ArrowRight') onAnswer('b')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onAnswer])
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between text-[13px] text-content-muted">
        <span>Question {index + 1} of {total}</span>
        {value && <button type="button" onClick={() => onAnswer(null)} className="text-accent-on underline underline-offset-2">Clear answer</button>}
      </div>
      <div key={card.id} className="tz-rise grid grid-cols-2 gap-3 sm:gap-4" role="radiogroup" aria-label={`Question ${index + 1}`}>
        {(['a', 'b'] as const).map((k) => {
          const on = value === k
          return (
            <button key={k} type="button" role="radio" aria-checked={on} onClick={() => onAnswer(k)}
              className={`group relative flex min-h-[170px] flex-col items-center justify-center gap-3 rounded-[24px] border-2 p-4 text-center transition sm:min-h-[200px] ${on ? 'border-[var(--accent)] bg-accent-subtle' : 'border-edge bg-surface-secondary hover:-translate-y-0.5 hover:border-[var(--accent)]'}`}>
              {on && <span className="absolute end-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-text"><Check className="h-3.5 w-3.5" /></span>}
              <span className="text-[48px] transition group-hover:scale-110 sm:text-[54px]" aria-hidden>{card[k].emoji}</span>
              <span className="text-[15px] font-semibold text-content sm:text-[17px]">{card[k].label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function DnaProgress({ answered, total }: { answered: number; total: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered} aria-label="Travel DNA questions answered">
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
    </div>
  )
}

/** Loading / error states for the question set. Returns null once questions are ready. */
export function DnaCardsStatus({ state }: { state: DnaCardsState }): React.ReactElement | null {
  if (state.status === 'ready') return null
  if (state.status === 'loading') {
    return (
      <div className="grid grid-cols-2 gap-4" aria-busy="true" aria-label="Loading questions">
        {[0, 1].map((i) => <div key={i} className="min-h-[170px] animate-pulse rounded-[24px] bg-surface-secondary sm:min-h-[200px]" />)}
      </div>
    )
  }
  return (
    <div className="rounded-[24px] border border-dashed border-edge p-8 text-center" role="alert">
      <p className="font-serif text-[22px] text-content">The questions didn't load</p>
      <p className="mx-auto mt-2 max-w-sm text-[14px] text-content-muted">{state.error}. Your answers so far are kept.</p>
      <button type="button" onClick={state.retry} className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-accent-text"><RefreshCw className="h-4 w-4" />Try again</button>
    </div>
  )
}

export function BackLink({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="inline-flex items-center gap-1 text-[14px] text-content-muted hover:text-content disabled:opacity-30"><ArrowLeft className="h-4 w-4" />Back</button>
}
