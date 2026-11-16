/**
 * The 13 questions. The first three are trip-level (the group organiser answers
 * them); the other nine are personal (every member answers them).
 * Content merged from the old Travel DNA cards, brief parser and onboarding.
 */
export const TAGS = ['history', 'culture', 'food', 'shopping', 'nature', 'spiritual', 'art', 'nightlife', 'photography', 'adventure', 'kids', 'entertainment', 'beach'] as const
export type Tag = (typeof TAGS)[number]

export type Answers = {
  /** sample-city key or destination name */
  city?: string
  /** any place in India chosen with the search box */
  place?: { name: string; lat: number; lon: number; state?: string }
  start?: string
  days?: number
  party?: 'solo' | 'couple' | 'friends' | 'kids' | 'seniors'
  budget?: number // per person per day, 0 = no limit
  pace?: number // 1 relaxed, 2 balanced, 3 packed
  diet?: number // 0 anything, 1 vegetarian, 2 pure-veg kitchens only
  interests?: Tag[]
  morning?: 'early' | 'late'
  effort?: 'high' | 'low'
  evening?: 'spiritual' | 'nightlife' | 'early'
  food?: 'street' | 'sitdown'
  /** ways of getting around between stops the traveller is comfortable with */
  getaround?: GetAround[]
}
export type GetAround = 'walk' | 'auto' | 'bike' | 'cab' | 'transit' | 'owncar' | 'ownscooter'

type Option = { value: string | number; label: string; emoji: string }
export type Question = {
  id: keyof Answers; scope: 'trip' | 'personal'; title: string; help?: string
  kind: 'choice' | 'multi' | 'date' | 'enddate' | 'place'; options?: Option[]
}

export const QUESTIONS: Question[] = [
  { id: 'city', scope: 'trip', title: 'Where are you going?', help: 'Any city, town or region in India.', kind: 'place', options: [
    { value: 'hyderabad', label: 'Hyderabad', emoji: '🕌' }, { value: 'jaipur', label: 'Jaipur', emoji: '🏰' }] },
  { id: 'start', scope: 'trip', title: 'When does the trip start?', kind: 'date' },
  { id: 'days', scope: 'trip', title: 'When does the trip end?', help: 'Pick the last day of the trip — stay as long as you like. Tripzy shows how long most people spend there.', kind: 'enddate' },
  { id: 'party', scope: 'personal', title: "Who's travelling with you?", kind: 'choice', options: [
    { value: 'solo', label: 'Just me', emoji: '🧍' }, { value: 'couple', label: 'Partner', emoji: '👫' }, { value: 'friends', label: 'Friends', emoji: '🧑‍🤝‍🧑' },
    { value: 'kids', label: 'Family with kids', emoji: '👨‍👩‍👧' }, { value: 'seniors', label: 'With parents / seniors', emoji: '👵' }] },
  { id: 'getaround', scope: 'personal', title: 'How do you like to get around between places?', help: 'Pick every way you are comfortable with — Tripzy picks the best one for each hop.', kind: 'multi', options: [
    { value: 'walk', label: 'Walk short hops', emoji: '🚶' }, { value: 'auto', label: 'Auto', emoji: '🛺' }, { value: 'bike', label: 'Bike taxi', emoji: '🏍️' },
    { value: 'cab', label: 'Cab', emoji: '🚕' }, { value: 'transit', label: 'Metro / bus', emoji: '🚇' }, { value: 'owncar', label: 'My car', emoji: '🚗' }, { value: 'ownscooter', label: 'My scooter', emoji: '🛵' }] },
  { id: 'budget', scope: 'personal', title: 'Your budget per day (per person)?', help: 'Tickets, food and local travel. Hotels are not included.', kind: 'choice', options: [
    { value: 800, label: 'Up to ₹800', emoji: '💰' }, { value: 2000, label: 'Up to ₹2,000', emoji: '💵' }, { value: 4000, label: 'Up to ₹4,000', emoji: '💳' }, { value: 0, label: 'No limit', emoji: '💎' }] },
  { id: 'pace', scope: 'personal', title: 'What pace suits you?', kind: 'choice', options: [
    { value: 1, label: '2–3 places, done properly', emoji: '🧘' }, { value: 2, label: 'Balanced', emoji: '🚶' }, { value: 3, label: 'Pack in as much as possible', emoji: '⚡' }] },
  { id: 'diet', scope: 'personal', title: 'Food preference?', kind: 'choice', options: [
    { value: 0, label: 'I eat anything', emoji: '🍗' }, { value: 1, label: 'Vegetarian', emoji: '🥗' }, { value: 2, label: 'Pure-veg restaurants only', emoji: '🌿' }] },
  { id: 'interests', scope: 'personal', title: 'What do you love? Pick any.', help: 'Choose at least one.', kind: 'multi', options: [
    { value: 'history', label: 'History', emoji: '🏛️' }, { value: 'culture', label: 'Culture', emoji: '🎭' }, { value: 'food', label: 'Food', emoji: '🍛' },
    { value: 'shopping', label: 'Shopping', emoji: '🛍️' }, { value: 'nature', label: 'Nature', emoji: '🌿' }, { value: 'spiritual', label: 'Spiritual', emoji: '🪔' },
    { value: 'art', label: 'Art & museums', emoji: '🖼️' }, { value: 'nightlife', label: 'City at night', emoji: '🌃' }, { value: 'photography', label: 'Photography', emoji: '📸' },
    { value: 'adventure', label: 'Adventure', emoji: '🧗' }, { value: 'kids', label: 'Kid-friendly', emoji: '🎡' }, { value: 'entertainment', label: 'Entertainment', emoji: '🎬' },
    { value: 'beach', label: 'Beaches & water sports', emoji: '🏖️' }] },
  { id: 'morning', scope: 'personal', title: 'Mornings?', kind: 'choice', options: [
    { value: 'early', label: 'Up early, start at 8', emoji: '🌅' }, { value: 'late', label: 'Slow start, from 10', emoji: '😴' }] },
  { id: 'effort', scope: 'personal', title: 'Climb 400 steps for the view?', kind: 'choice', options: [
    { value: 'high', label: "Yes, let's climb", emoji: '🧗' }, { value: 'low', label: 'The view from the café is fine', emoji: '☕' }] },
  { id: 'evening', scope: 'personal', title: 'Evenings?', kind: 'choice', options: [
    { value: 'spiritual', label: 'Temple aarti at dusk', emoji: '🪔' }, { value: 'nightlife', label: 'City lights', emoji: '🌆' }, { value: 'early', label: 'Back by 9', emoji: '🛏️' }] },
  { id: 'food', scope: 'personal', title: 'How do you like to eat?', kind: 'choice', options: [
    { value: 'street', label: 'Street-food crawl', emoji: '🍢' }, { value: 'sitdown', label: 'Trusted sit-down places', emoji: '🍽️' }] },
]

export const isAnswered = (a: Answers, id: keyof Answers) => {
  if (id === 'city') return !!(a.place || a.city)
  const v = a[id]
  return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''
}

/** Questions a person answers: the organiser and solo users answer all; group members only the personal ones. */
export const questionsFor = (role: 'solo' | 'owner' | 'member') => (role === 'member' ? QUESTIONS.filter((q) => q.scope === 'personal') : QUESTIONS)

// ---------------------------------------------------------------- group merge

export type MemberAnswers = { name: string; answers: Answers }
export type Merged = Answers & { votes: Partial<Record<Tag, string[]>> }

const majority = <T extends string>(vals: (T | undefined)[], fallback: T): T => {
  const c = new Map<T, number>()
  vals.forEach((v) => v && c.set(v, (c.get(v) ?? 0) + 1))
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback
}

/** budget = lowest, pace = slowest, diet = strictest, interests ranked by votes. */
export function mergeAnswers(trip: Answers, people: MemberAnswers[]): Merged {
  const A = people.map((p) => p.answers)
  const budgets = A.map((a) => a.budget ?? 0).filter((b) => b > 0)
  const votes: Partial<Record<Tag, string[]>> = {}
  people.forEach((p) => p.answers.interests?.forEach((t) => (votes[t] = [...(votes[t] ?? []), p.name])))
  const ranked = (Object.keys(votes) as Tag[]).sort((a, b) => votes[b]!.length - votes[a]!.length)
  const parties = A.map((a) => a.party)
  return {
    city: trip.city, place: trip.place, start: trip.start, days: trip.days,
    party: parties.includes('seniors') ? 'seniors' : parties.includes('kids') ? 'kids' : people.length > 1 ? 'friends' : parties[0] ?? 'solo',
    budget: budgets.length ? Math.min(...budgets) : 0,
    pace: Math.min(...A.map((a) => a.pace ?? 2)),
    diet: Math.max(...A.map((a) => a.diet ?? 0)),
    interests: ranked,
    morning: A.some((a) => a.morning === 'late') ? 'late' : 'early',
    effort: A.some((a) => a.effort === 'low') ? 'low' : 'high',
    evening: A.some((a) => a.evening === 'early') ? 'early' : majority(A.map((a) => a.evening), 'nightlife'),
    food: majority(A.map((a) => a.food), 'sitdown'),
    // ways everyone is comfortable with; if nobody overlaps, any one person's choices
    getaround: (() => {
      const lists = A.map((a) => a.getaround).filter((x): x is GetAround[] => !!x?.length)
      if (!lists.length) return undefined
      const common = lists.reduce((acc, l) => acc.filter((m) => l.includes(m)))
      return common.length ? common : [...new Set(lists.flat())]
    })(),
    votes,
  }
}

// ---------------------------------------------------------------- trip dates (calendar dates, no time zones)

/** Longest trip one plan covers. Beyond the places within reach, later days become free days. */
export const MAX_TRIP_DAYS = 30
const toUtc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10)
/** Today's date in the traveller's own time zone, as YYYY-MM-DD. */
export const localToday = () => { const n = new Date(); return fromUtc(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) }
/** Inclusive length: a trip from the 25th to the 26th is 2 days. */
export const tripDays = (start: string, end: string) => Math.round((toUtc(end) - toUtc(start)) / 86400000) + 1
/** Last day of a trip of `days` days starting on `start`. */
export const tripEnd = (start: string, days: number) => fromUtc(toUtc(start) + (Math.max(1, days) - 1) * 86400000)
