import { setDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../lib/auth'
import { createGroup, newId, setGroup, tripDoc, updateMember, write } from '../lib/db'
import { request } from '../lib/request'
import { ErrorBox, SaveStatus, Skeleton, useAction, useStatus } from '../lib/status'
import { useDraft } from '../lib/useDraft'
import { GroupPanel, ModeToggle, useGroup } from '../lib/useGroup'
import { generateBasic, isTrip, type Trip } from './generate'
import { isAnswered, mergeAnswers, questionsFor, QUESTIONS, type Answers, type Question } from './questions'

export type TourDraft = { answers: Answers; groupCode: string | null; doneTripId: string | null }
const EMPTY: TourDraft = { answers: {}, groupCode: null, doneTripId: null }
const AI_URL = import.meta.env.VITE_AI_PLANNER_URL as string | undefined

/** Optional AI planner behind request(); the app works fully without it. */
async function aiPlan(answers: Answers, groupSize: number): Promise<Trip> {
  const res = await fetch(AI_URL!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers, groupSize }) })
  if (!res.ok) throw Object.assign(new Error(`AI ${res.status}`), { code: res.status >= 500 ? 'unavailable' : 'invalid-argument' })
  const trip = await res.json()
  if (!isTrip(trip)) throw Object.assign(new Error('bad plan'), { code: 'unavailable' })
  return { ...trip, source: 'ai' }
}

type GroupResult = Trip & { at: number }

export default function TourPage() {
  const { user, profile } = useAuth()
  const { toast } = useStatus()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const draft = useDraft<TourDraft>('tour', EMPTY)
  const a = draft.value.answers
  const groupCode = params.get('group')

  const { group, error: groupError } = useGroup<GroupResult>(groupCode, () =>
    toast('Your group itinerary is ready', 'success', { label: 'Open', run: () => nav(`/tour/g_${groupCode}`) }),
  )
  const isOwner = !!group && group.ownerUid === user?.uid
  const role: 'solo' | 'owner' | 'member' = !groupCode ? 'solo' : group && !isOwner ? 'member' : 'owner'
  const qs = useMemo(() => questionsFor(role), [role])

  useEffect(() => {
    if (groupCode && draft.value.groupCode !== groupCode) draft.update((p) => ({ ...p, groupCode }))
  }, [groupCode, draft])

  // Position lives in the URL (?q=4 or ?q=review). Without it, resume at the first unanswered question.
  const firstOpen = qs.findIndex((q) => !isAnswered(a, q.id))
  const qParam = params.get('q')
  const step = qParam === 'review' ? qs.length : qParam ? Math.min(Math.max(Number(qParam) - 1, 0), qs.length) : firstOpen === -1 ? qs.length : firstOpen
  const go = (i: number, replace = false) => {
    const p = new URLSearchParams(params)
    p.set('q', i >= qs.length ? 'review' : String(i + 1))
    setParams(p, { replace })
  }

  const answer = (id: keyof Answers, v: unknown) => draft.update((p) => ({ ...p, doneTripId: null, answers: { ...p.answers, [id]: v } }))

  const startGroup = useAction(async () => {
    if (!user) return
    const code = await createGroup('tour', user.uid, profile.name)
    setParams({ group: code })
  })

  // ------------------------------------------------------------ generation
  const [aiFailed, setAiFailed] = useState('')
  const generate = useAction(async (basic: boolean) => {
    if (!user) return
    setAiFailed('')
    let merged = mergeAnswers(a, [{ name: profile.name, answers: a }])
    let size = 1
    if (groupCode && group) {
      // organiser's trip answers + every member who has sent theirs
      const people = group.memberUids
        .map((uid) => ({ name: group.members[uid]?.name ?? 'Member', answers: (uid === user.uid ? a : group.members[uid]?.answers) as Answers | undefined, ready: uid === user.uid || group.members[uid]?.ready }))
        .filter((m) => m.ready && m.answers)
        .map((m) => ({ name: m.name, answers: m.answers! }))
      merged = mergeAnswers(a, people)
      size = people.length
    }
    let trip: Trip
    if (AI_URL && !basic) {
      try {
        trip = await request(() => aiPlan(merged, size), { key: 'ai-plan', timeoutMs: 20000 })
      } catch (e) {
        setAiFailed((e as Error).message)
        return
      }
    } else trip = generateBasic(merged, size)

    if (groupCode) {
      const result: GroupResult = { ...trip, groupCode, at: Date.now() }
      await updateMember(groupCode, user.uid, { ready: true })
      await setGroup(groupCode, { result, settings: { city: a.city, start: a.start, days: a.days } })
      await write(() => setDoc(tripDoc(user.uid, `g_${groupCode}`), { title: `${trip.title} (group)`, groupCode, updatedAt: Date.now() }))
      draft.update((p) => ({ ...p, doneTripId: `g_${groupCode}` }))
      nav(`/tour/g_${groupCode}`)
    } else {
      const id = newId()
      const res = await write(() => setDoc(tripDoc(user.uid, id), trip), `trip:${id}`)
      if (res === 'local') toast('Trip saved on this device — will sync when online')
      draft.update((p) => ({ ...p, doneTripId: id }))
      nav(`/tour/${id}`)
    }
  })

  const sendAnswers = useAction(async () => {
    if (!user || !groupCode) return
    const personal = Object.fromEntries(Object.entries(a).filter(([k]) => QUESTIONS.find((q) => q.id === k)?.scope === 'personal'))
    await updateMember(groupCode, user.uid, { answers: personal, ready: true })
    toast('Answers sent to the group', 'success')
  })

  const allDone = qs.every((q) => isAnswered(a, q.id))
  const mode: 'solo' | 'group' = groupCode ? 'group' : 'solo'

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tourist Planner</h1>
          <p className="text-sm text-slate-600">12 quick questions, then a day-by-day plan you can edit. <span className="sample">Sample data</span></p>
        </div>
        <div className="flex items-center gap-3">
          <SaveStatus status={draft.status} onRetry={() => void draft.retry()} />
          <ModeToggle
            value={mode}
            disabled={startGroup.busy}
            onChange={(v) => {
              if (v === 'solo') setParams({})
              else if (draft.value.groupCode && draft.value.groupCode !== groupCode) setParams({ group: draft.value.groupCode })
              else void startGroup.run()
            }}
          />
        </div>
      </div>
      {startGroup.error && <ErrorBox message={startGroup.error} onRetry={() => void startGroup.retry()} />}

      {groupCode && (groupError ? (
        <ErrorBox message={groupError}>
          <button className="btn-secondary" onClick={() => { draft.update((p) => ({ ...p, groupCode: null })); setParams({}) }}>Back to solo</button>
        </ErrorBox>
      ) : (
        <GroupPanel code={groupCode} group={group} type="tour">
          <p className="text-sm text-slate-600">
            {role === 'member'
              ? `${group?.members[group.ownerUid]?.name ?? 'The organiser'} chooses the destination and dates. You answer ${qs.length} personal questions.`
              : 'You answer the trip questions. Everyone answers the personal ones from the invite link. Budget = lowest, pace = slowest, diet = strictest, interests by votes.'}
          </p>
          {group?.result && (
            <Link className="btn" to={`/tour/g_${groupCode}`}>Open group itinerary</Link>
          )}
        </GroupPanel>
      ))}

      {groupCode && !group && !groupError ? (
        <Skeleton lines={2} />
      ) : step < qs.length ? (
        <QuestionCard
          q={qs[step]} index={step} total={qs.length} answers={a}
          onAnswer={(v, advance) => {
            answer(qs[step].id, v)
            if (advance) go(step + 1)
          }}
          onBack={() => go(step - 1)} onNext={() => go(step + 1)}
        />
      ) : (
        <section className="card space-y-4" aria-label="Review answers">
          <h2 className="text-lg font-semibold">Your answers</h2>
          <ul className="divide-y divide-slate-100">
            {qs.map((q, i) => (
              <li key={q.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-slate-600">{i + 1}. {q.title}</span>
                <span className="flex items-center gap-2 text-right font-medium">
                  {display(q, a) || <span className="text-red-700">Not answered</span>}
                  <button className="btn-link" onClick={() => go(i)}>Edit</button>
                </span>
              </li>
            ))}
          </ul>
          {aiFailed && (
            <ErrorBox message="The AI planner didn't respond. You can try again, or get a basic plan built from the local sample data right now." onRetry={() => void generate.run(false)}>
              <button className="btn-secondary" onClick={() => void generate.run(true)}>Basic plan</button>
            </ErrorBox>
          )}
          {generate.error && <ErrorBox message={generate.error} onRetry={() => void generate.retry()} />}
          {generate.busy && <Skeleton lines={3} />}
          {role === 'member' ? (
            group?.members[user!.uid]?.ready ? (
              <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
                Answers sent. You'll see a notification when the organiser creates the plan. You can still edit and resend.
              </p>
            ) : null
          ) : null}
          <div className="flex flex-wrap gap-2">
            {role === 'member' ? (
              <button className="btn" disabled={!allDone || sendAnswers.busy} onClick={() => void sendAnswers.run()}>
                {sendAnswers.busy ? 'Sending…' : group?.members[user!.uid]?.ready ? 'Resend my answers' : 'Send my answers'}
              </button>
            ) : (
              <button className="btn" disabled={!allDone || generate.busy} onClick={() => void generate.run(false)}>
                {generate.busy ? 'Building your plan…' : role === 'owner' ? 'Create group plan' : 'Create my plan'}
              </button>
            )}
            {draft.value.doneTripId && role !== 'member' && (
              <Link className="btn-secondary" to={`/tour/${draft.value.doneTripId}`}>Open last plan</Link>
            )}
            {role === 'solo' && (
              <button className="btn-secondary" onClick={() => { draft.reset(); setParams({}) }}>Start over</button>
            )}
          </div>
          {sendAnswers.error && <ErrorBox message={sendAnswers.error} onRetry={() => void sendAnswers.retry()} />}
          {role === 'owner' && group && (
            <p className="text-xs text-slate-500">
              {group.memberUids.filter((u) => u === user?.uid || group.members[u]?.ready).length} of {group.memberUids.length} people's answers will be used. Members who haven't sent theirs are left out.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function display(q: Question, a: Answers): string {
  const v = a[q.id]
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return ''
  if (q.kind === 'date') return new Date(`${v}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  if (Array.isArray(v)) return v.map((x) => q.options?.find((o) => o.value === x)?.label ?? x).join(', ')
  return q.options?.find((o) => o.value === v)?.label ?? String(v)
}

function QuestionCard({ q, index, total, answers, onAnswer, onBack, onNext }: {
  q: Question; index: number; total: number; answers: Answers
  onAnswer: (v: unknown, advance: boolean) => void; onBack: () => void; onNext: () => void
}) {
  const v = answers[q.id]
  const today = new Date().toISOString().slice(0, 10)
  const answered = isAnswered(answers, q.id)
  return (
    <section className="card" aria-labelledby="q-title">
      <div className="mb-2 flex items-center justify-between text-sm text-slate-500">
        <span>{index + 1} of {total}</span>
        <span>{q.scope === 'trip' ? 'Trip question' : 'About you'}</span>
      </div>
      <div className="mb-5 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index}>
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(index / total) * 100}%` }} />
      </div>
      <h2 id="q-title" className="text-xl font-semibold">{q.title}</h2>
      {q.help && <p className="mt-1 text-sm text-slate-600">{q.help}</p>}

      <div className="mt-4">
        {q.kind === 'date' ? (
          <div>
            <label htmlFor="date" className="label">Start date</label>
            <input id="date" type="date" min={today} className="input max-w-xs" value={(v as string) ?? ''} onChange={(e) => onAnswer(e.target.value, false)} />
            {typeof v === 'string' && v < today && <p className="field-error">Pick today or a later date.</p>}
          </div>
        ) : (
          <div className={`grid gap-3 ${q.kind === 'multi' || (q.options?.length ?? 0) > 3 ? 'grid-cols-2 sm:grid-cols-3' : (q.options?.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2')}`} role={q.kind === 'multi' ? 'group' : 'radiogroup'} aria-labelledby="q-title">
            {q.options!.map((o) => {
              const on = q.kind === 'multi' ? ((v as string[]) ?? []).includes(o.value as string) : v === o.value
              return (
                <button
                  key={String(o.value)}
                  role={q.kind === 'multi' ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  onClick={() => {
                    if (q.kind === 'multi') {
                      const cur = (v as string[]) ?? []
                      onAnswer(on ? cur.filter((x) => x !== o.value) : [...cur, o.value], false)
                    } else onAnswer(o.value, true)
                  }}
                  className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 text-center text-sm font-semibold transition ${on ? 'border-brand-700 bg-brand-50' : 'border-slate-200 bg-white hover:border-brand-600'}`}
                >
                  <span className="text-2xl" aria-hidden>{o.emoji}</span>
                  {o.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-between">
        <button className="btn-secondary" onClick={onBack} disabled={index === 0}>← Back</button>
        <button className="btn" onClick={onNext} disabled={!answered || (q.kind === 'date' && (v as string) < today)}>
          {index === total - 1 ? 'Review →' : 'Next →'}
        </button>
      </div>
    </section>
  )
}
