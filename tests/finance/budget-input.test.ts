import { describe, expect, test } from 'vitest'

import { parseBudgetAmount, parseSavingsTarget } from '@/features/budgets/budget-input'

describe('budget input parsing', () => {
  test('accepts empty, zero, and comma-formatted won amounts', () => {
    expect(parseBudgetAmount('')).toBe(0)
    expect(parseBudgetAmount('0')).toBe(0)
    expect(parseBudgetAmount('1,250,000원')).toBe(1_250_000)
  })

  test('rejects negative and fractional budgets', () => {
    expect(parseBudgetAmount('-1')).toBeNull()
    expect(parseBudgetAmount('1.5')).toBeNull()
  })

  test('limits savings targets to 0 through 80 percent', () => {
    expect(parseSavingsTarget('30')).toBe(30)
    expect(parseSavingsTarget('80')).toBe(80)
    expect(parseSavingsTarget('81')).toBeNull()
  })
})
