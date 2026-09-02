import { describe, expect, test } from 'vitest'

import {
  medianAmount,
  projectedSavingsRate,
  suggestedBudget,
} from '@/features/budgets/review-calculations'

describe('budget review calculations', () => {
  test('calculates the median without mutating source values', () => {
    const values = [300_000, 100_000, 200_000]
    expect(medianAmount(values)).toBe(200_000)
    expect(values).toEqual([300_000, 100_000, 200_000])
    expect(medianAmount([100_000, 300_000])).toBe(200_000)
    expect(medianAmount([])).toBe(0)
  })

  test('uses saved target budgets before group-specific suggestions', () => {
    expect(suggestedBudget({ group: 'variable', existing: 123_000, previousBudget: 200_000, previousActual: 210_000, median: 190_000 })).toBe(123_000)
    expect(suggestedBudget({ group: 'variable', existing: null, previousBudget: 200_000, previousActual: 210_000, median: 190_000 })).toBe(190_000)
    expect(suggestedBudget({ group: 'fixed', existing: null, previousBudget: 200_000, previousActual: 210_000, median: 190_000 })).toBe(200_000)
    expect(suggestedBudget({ group: 'irregular', existing: null, previousBudget: 0, previousActual: 210_000, median: 190_000 })).toBe(190_000)
  })

  test('projects net savings from income and the proposed spending plan', () => {
    expect(projectedSavingsRate(5_000_000, 3_500_000)).toBe(30)
    expect(projectedSavingsRate(0, 3_500_000)).toBe(0)
  })
})
