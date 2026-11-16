import { describe, expect, it } from 'vitest'
import { tripDays, tripEnd } from './questions'

describe('trip dates', () => {
  it('counts both the first and the last day', () => {
    expect(tripDays('2026-11-25', '2026-11-25')).toBe(1)
    expect(tripDays('2026-11-25', '2026-11-26')).toBe(2)
    expect(tripDays('2026-11-29', '2026-12-03')).toBe(5)
  })
  it('round-trips start + days back to the end date, across months and DST-free calendar math', () => {
    expect(tripEnd('2026-11-25', 2)).toBe('2026-11-26')
    expect(tripEnd('2026-12-30', 4)).toBe('2027-01-02')
    expect(tripEnd('2028-02-28', 2)).toBe('2028-02-29')
  })
})
