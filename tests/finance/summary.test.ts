import { describe, expect, test } from 'vitest'

import { isMonthKey, monthBounds, savingsRate, shiftMonth } from '@/lib/finance'

describe('monthly finance calculations', () => {
  test('uses net savings for the savings rate', () => {
    expect(savingsRate(7_500_000, 5_250_000)).toBe(30)
    expect(savingsRate(0, 100_000)).toBe(0)
  })

  test('moves across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  test('builds an inclusive-exclusive month range', () => {
    expect(monthBounds('2026-07')).toEqual({
      start: '2026-07-01',
      end: '2026-08-01',
    })
  })

  test('rejects malformed month keys', () => {
    expect(isMonthKey('2026-07')).toBe(true)
    expect(isMonthKey('2026-7')).toBe(false)
    expect(isMonthKey('2026-13')).toBe(false)
  })
})
