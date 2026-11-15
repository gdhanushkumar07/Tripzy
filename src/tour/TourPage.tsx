import { setDoc } from 'firebase/firestore'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { Card, Eyebrow } from '../ui/kit'
import { photoSrc, type PhotoId } from '../ui/photos'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../lib/auth'
import { createGroup, newId, setGroup, tripDoc, updateMember, write } from '../lib/db'
import { api, type GeoPoint } from '../lib/api'
import { logEvent, useTaste } from '../lib/history'
import { toFriendly } from '../lib/request'
import { LocationInput } from '../ui/LocationInput'
import { ErrorBox, SaveStatus, Skeleton, useAction, useStatus } from '../lib/status'
import { useDraft } from '../lib/useDraft'
import { GroupPanel, ModeToggle, useGroup } from '../lib/useGroup'
import { generateBasic, type Trip } from './generate'
import { isAnswered, mergeAnswers, questionsFor, QUESTIONS, type Answers, type Question } from './questions'

export type TourDraft = { answers: Answers; groupCode: string | null; doneTripId: string | null }
const EMPTY: TourDraft = { answers: {}, groupCode: null, doneTripId: null }
/** Offline sample cities (the bundled "Basic plan" data). Everything else is planned live. */
const SAMPLE: Record<string, GeoPoint> = {
  hyderabad: { name: 'Hyderabad', lat: 17.385, lon: 78.4867, state: 'Telangana' },
  jaipur: { name: 'Jaipur', lat: 26.9124, lon: 75.7873, state: 'Rajasthan' },
}
const sampleKey = (p: { name: string; lat: number; lon: number }) =>
  Object.keys(SAMPLE).find((k) => Math.hypot(SAMPLE[k].lat - p.lat, SAMPLE[k].lon - p.lon) < 0.3 || p.name.toLowerCase().includes(k))
const QUICK: GeoPoint[] = [
  { name: 'Goa', lat: 15.4909, lon: 73.8278, state: 'Goa' }, { name: 'Mysuru', lat: 12.2958, lon: 76.6394, state: 'Karnataka' },
  { name: 'Varanasi', lat: 25.3176, lon: 82.9739, state: 'Uttar Pradesh' }, { name: 'Udaipur', lat: 24.5854, lon: 73.7125, state: 'Rajasthan' },
  { name: 'Kochi', lat: 9.9312, lon: 76.2673, state: 'Kerala' }, { name: 'Delhi', lat: 28.6139, lon: 77.209, state: 'Delhi' },
  { name: 'Hampi', lat: 15.335, lon: 76.46, state: 'Karnataka' }, { name: 'Rishikesh', lat: 30.0869, lon: 78.2676, state: 'Uttarakhand' },
]

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

  const answer = (id: keyof Answers, v: unknown) => draft.update((p) => {
    if (id === 'city' && v && typeof v === 'object') {
      const place = v as GeoPoint
      return { ...p, doneTripId: null, answers: { ...p.answers, place: { name: place.name, lat: place.lat, lon: place.lon, state: place.state }, city: sampleKey(place) ?? place.name } }
    }
    return { ...p, doneTripId: null, answers: { ...p.answers, [id]: v } }
  })
  const taste = useTaste(user?.uid)

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
    const place = merged.place ?? (merged.city ? SAMPLE[merged.city] : undefined)
    if (!basic) {
      // live: real places, opening hours, weather, air quality, AI web checks, your history weights
      try {
        trip = await api.post<Trip>('/api/tour/plan', { answers: merged, groupSize: size, place, boost: taste?.boost, boostWhy: taste?.boostWhy }, `tour:${JSON.stringify(merged)}`)
      } catch (e) {
        setAiFailed(toFriendly(e).message)
        return
      }
    } else {
      const key = merged.city && SAMPLE[merged.city] ? merged.city : place ? sampleKey(place) : undefined
      if (!key) throw Object.assign(new Error('basic'), { code: 'failed-precondition' })
      trip = generateBasic({ ...merged, city: key }, size)
    }
    logEvent(user.uid, { type: 'trip_created', at: Date.now(), city: place?.name ?? merged.city ?? '', interests: merged.interests ?? [], days: merged.days ?? 1, budget: merged.budget })

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
    <div className="mx-auto max-w-4xl space-y-6 px-5 pb-24 pt-10 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="tz-chapter">Not another generic itinerary.</div>
          <h1 className="tz-h1 mt-2 text-content">Tourist Planner</h1>
          <p className="mt-3 max-w-xl text-[16px] text-content-muted">12 quick questions, then a day-by-day plan anywhere in India — real places, opening hours, weather and air quality, shaped by your past trips.</p>
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
          <p className="text-sm text-content-muted">
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
          <div className="tz-kicker">Review</div><h2 className="font-serif text-[32px] leading-tight text-content">Your answers</h2>
          <ul className="divide-y divide-edge">
            {qs.map((q, i) => (
              <li key={q.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-content-muted">{i + 1}. {q.title}</span>
                <span className="flex items-center gap-2 text-right font-medium">
                  {display(q, a) || <span className="text-danger">Not answered</span>}
                  <button className="btn-link" onClick={() => go(i)}>Edit</button>
                </span>
              </li>
            ))}
          </ul>
          {aiFailed && (
            <ErrorBox message={`The live planner couldn't finish: ${aiFailed} You can try again${a.place && sampleKey(a.place) ? ', or get a basic plan from the offline sample data right now' : ''}.`} onRetry={() => void generate.run(false)}>
              {(!a.place || sampleKey(a.place)) && <button className="btn-secondary" onClick={() => void generate.run(true)}>Basic plan (offline)</button>}
            </ErrorBox>
          )}
          {generate.error && <ErrorBox message={generate.error} onRetry={() => void generate.retry()} />}
          {generate.busy && <Skeleton lines={3} />}
          {role === 'member' ? (
            group?.members[user!.uid]?.ready ? (
              <p className="rounded-xl bg-accent-subtle p-3 text-sm text-accent-on">
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
            <p className="text-xs text-content-muted">
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
  if (q.id === 'city') return a.place?.name ?? (q.options?.find((o) => o.value === v)?.label ?? String(v))
  if (q.kind === 'date') return new Date(`${v}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  if (Array.isArray(v)) return v.map((x) => q.options?.find((o) => o.value === x)?.label ?? x).join(', ')
  return q.options?.find((o) => o.value === v)?.label ?? String(v)
}

const CITY_TILE: Record<string, PhotoId> = { hyderabad: 'charminar', jaipur: 'hawa-mahal' }

function QuestionCard({ q, index, total, answers, onAnswer, onBack, onNext }: {
  q: Question; index: number; total: number; answers: Answers
  onAnswer: (v: unknown, advance: boolean) => void; onBack: () => void; onNext: () => void
}) {
  const v = answers[q.id]
  const today = new Date().toISOString().slice(0, 10)
  const answered = isAnswered(answers, q.id)
  const many = q.kind === 'multi' || (q.options?.length ?? 0) > 3
  return (
    <Card className="flex min-h-[460px] flex-col p-6 sm:p-8" aria-labelledby="q-title" role="region">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Eyebrow className="tz-coral-text">{q.scope === 'trip' ? 'Trip question' : 'About you'} · Travel DNA</Eyebrow>
          <h2 id="q-title" className="mt-2 font-serif text-[34px] leading-[1.05] text-content sm:text-[40px]">{q.title}</h2>
          {q.help && <p className="mt-2 text-body text-content-muted">{q.help}</p>}
        </div>
        <span className="shrink-0 text-body font-semibold tabular-nums text-content-muted">{index + 1} of {total}</span>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-surface-tertiary" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index} aria-label="Questions answered">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(index / total) * 100}%` }} />
      </div>

      <div key={q.id} className="tz-rise mt-8 flex-1">
        {q.kind === 'place' ? (
          <div className="space-y-5">
            <LocationInput label="Destination" value={answers.place ?? null} onChange={(p) => p && onAnswer(p, false)} placeholder="Search a city, town or region — e.g. Hampi, Munnar, Varanasi" allowLocate={false} />
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {(['hyderabad', 'jaipur'] as const).map((k) => {
                const on = answers.city === k
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} onClick={() => onAnswer(SAMPLE[k], true)}
                    className={`group relative min-h-[180px] overflow-hidden rounded-[24px] border-2 text-start transition ${on ? 'border-[var(--accent)]' : 'border-transparent hover:-translate-y-0.5'}`}>
                    <img src={photoSrc(CITY_TILE[k], true)} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />
                    <span className="absolute inset-0 bg-gradient-to-t from-[#18211F]/85 via-[#18211F]/20 to-transparent" />
                    {on && <span className="absolute end-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-accent text-accent-text"><Check className="h-4 w-4" /></span>}
                    <span className="absolute bottom-4 left-5 font-serif text-[32px] leading-none text-white">{SAMPLE[k].name}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK.map((p) => (
                <button key={p.name} type="button" onClick={() => onAnswer(p, true)} className={`chip ${answers.place?.name === p.name ? 'chip-on' : 'chip-off'}`}>{p.name}</button>
              ))}
            </div>
          </div>
        ) : q.kind === 'date' ? (
          <div className="max-w-xs">
            <label htmlFor="date" className="label">Start date</label>
            <input id="date" type="date" min={today} className="tz-input" value={(v as string) ?? ''} onChange={(e) => onAnswer(e.target.value, false)} />
            {typeof v === 'string' && v < today && <p className="field-error">Pick today or a later date.</p>}
          </div>
        ) : (
          <div className={`grid gap-3 sm:gap-4 ${many ? 'grid-cols-2 sm:grid-cols-3' : q.options?.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`} role={q.kind === 'multi' ? 'group' : 'radiogroup'} aria-labelledby="q-title">
            {q.options!.map((o) => {
              const on = q.kind === 'multi' ? ((v as string[]) ?? []).includes(o.value as string) : v === o.value
              const photo = q.id === 'city' ? CITY_TILE[String(o.value)] : undefined
              const pick = () => {
                if (q.kind === 'multi') {
                  const cur = (v as string[]) ?? []
                  onAnswer(on ? cur.filter((x) => x !== o.value) : [...cur, o.value], false)
                } else onAnswer(o.value, true)
              }
              if (photo) {
                return (
                  <button key={String(o.value)} type="button" role="radio" aria-checked={on} onClick={pick}
                    className={`group relative min-h-[220px] overflow-hidden rounded-[24px] border-2 text-start transition ${on ? 'border-[var(--accent)]' : 'border-transparent hover:-translate-y-0.5'}`}>
                    <img src={photoSrc(photo, true)} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />
                    <span className="absolute inset-0 bg-gradient-to-t from-[#18211F]/85 via-[#18211F]/20 to-transparent" />
                    {on && <span className="absolute end-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-accent text-accent-text"><Check className="h-4 w-4" /></span>}
                    <span className="absolute bottom-4 left-5 font-serif text-[32px] leading-none text-white">{o.label}</span>
                  </button>
                )
              }
              return (
                <button key={String(o.value)} type="button" role={q.kind === 'multi' ? 'checkbox' : 'radio'} aria-checked={on} onClick={pick}
                  className={`group relative flex flex-col items-center justify-center gap-2.5 rounded-[24px] border-2 p-4 text-center transition ${many ? 'min-h-[120px]' : 'min-h-[170px] sm:min-h-[200px]'} ${on ? 'border-[var(--accent)] bg-accent-subtle' : 'border-edge bg-surface-secondary hover:-translate-y-0.5 hover:border-[var(--accent)]'}`}>
                  {on && <span className="absolute end-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-text"><Check className="h-3.5 w-3.5" /></span>}
                  <span className={`${many ? 'text-[36px]' : 'text-[48px] sm:text-[54px]'} transition group-hover:scale-110`} aria-hidden>{o.emoji}</span>
                  <span className="text-[15px] font-semibold text-content sm:text-[16px]">{o.label}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button type="button" onClick={onBack} disabled={index === 0} className="inline-flex items-center gap-1 text-body text-content-muted hover:text-content disabled:opacity-30"><ArrowLeft className="h-4 w-4" />Back</button>
        <button type="button" className="btn" onClick={onNext} disabled={!answered || (q.kind === 'date' && (v as string) < today)}>
          {index === total - 1 ? 'Review' : 'Next'}<ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </Card>
  )
}
