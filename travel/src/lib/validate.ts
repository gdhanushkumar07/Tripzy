/** Client-side validation. The same limits are enforced again in firestore.rules. */

export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

export function nameError(s: string): string {
  const t = s.trim()
  if (!t) return 'Please enter your name.'
  if (t.length > 40) return 'Name must be 40 characters or fewer.'
  return ''
}

export function passwordError(s: string): string {
  if (s.length < 6) return 'Password must be at least 6 characters.'
  return ''
}

export function budgetError(v: number | null): string {
  if (v == null) return ''
  if (!Number.isFinite(v) || v < 0 || v > 100000) return 'Budget must be between ₹0 and ₹1,00,000.'
  return ''
}

export function transfersError(v: number | null): string {
  if (v == null) return ''
  if (!Number.isInteger(v) || v < 0 || v > 5) return 'Max transfers must be a whole number from 0 to 5.'
  return ''
}

export const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)

/** Parse an optional number input ('' → null). */
export const optNum = (s: string): number | null => (s.trim() === '' ? null : Number(s))
