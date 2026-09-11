import { describe, expect, test } from 'vitest'

import { calculateAverage3, differenceCaption, initialSource } from '@/features/budgets/plan-calculations'
import type { BudgetPlanRow } from '@/features/budgets/plan-sources'

const saved = { amount: 240_000, recommendationJobId: null, version: 'version' }
const row = (overrides: Partial<BudgetPlanRow> = {}): BudgetPlanRow => ({
  major: '식비',
  group: 'variable',
  saved,
  actual: 0,
  previousBudget: 220_000,
  previousActual: { amount: 230_000, month: '2026-09', partial: null },
  average3: { amount: 210_000, months: ['2026-08', '2026-07', '2026-06'], monthsWithSpend: 3, provisional: false },
  ...overrides,
})

describe('calculateAverage3', () => {
  test('keeps only candidate months with household records without backfilling older months', () => {
    expect(calculateAverage3({
      candidateMonths: ['2026-08', '2026-07', '2026-06'],
      transactionMonths: ['2026-08', '2026-06', '2026-05'],
      majorMonthlyAmounts: [
        { month: '2026-08', amount: 5 },
        { month: '2026-06', amount: 0 },
        { month: '2026-05', amount: 999 },
      ],
      monthStatuses: [
        { month: '2026-08', state: 'closed' },
        { month: '2026-06', state: 'closed' },
        { month: '2026-05', state: 'open' },
      ],
    })).toEqual({
      amount: 2,
      months: ['2026-08', '2026-06'],
      monthsWithSpend: 2,
      spendMonths: ['2026-08', '2026-06'],
      provisional: false,
    })
  })

  test('counts an income-only month as zero expense and tracks spend months for the irregular caption', () => {
    expect(calculateAverage3({
      candidateMonths: ['2026-08', '2026-07', '2026-06'],
      transactionMonths: ['2026-08', '2026-07', '2026-06'],
      majorMonthlyAmounts: [{ month: '2026-08', amount: 600 }, { month: '2026-06', amount: 300 }],
      monthStatuses: [
        { month: '2026-08', state: 'closed' },
        { month: '2026-07', state: 'closed' },
        { month: '2026-06', state: 'closed' },
      ],
    })).toEqual({
      amount: 300,
      months: ['2026-08', '2026-07', '2026-06'],
      monthsWithSpend: 2,
      spendMonths: ['2026-08', '2026-06'],
      provisional: false,
    })
  })

  test.each([
    [5, 2],
    [7, 4],
  ])('uses Python tie-to-even rounding for a two-month average of %i', (total, expected) => {
    expect(calculateAverage3({
      candidateMonths: ['2026-08', '2026-07', '2026-06'],
      transactionMonths: ['2026-08', '2026-07'],
      majorMonthlyAmounts: [{ month: '2026-08', amount: total }],
      monthStatuses: [{ month: '2026-08', state: 'closed' }, { month: '2026-07', state: 'closed' }],
    }).amount).toBe(expected)
  })

  test('supports fewer than three months and marks any retained non-closed month provisional', () => {
    expect(calculateAverage3({
      candidateMonths: ['2026-08', '2026-07', '2026-06'],
      transactionMonths: ['2026-07'],
      majorMonthlyAmounts: [{ month: '2026-07', amount: 450 }],
      monthStatuses: [{ month: '2026-07', state: 'needs_review' }, { month: '2026-06', state: 'open' }],
    })).toEqual({
      amount: 450,
      months: ['2026-07'],
      monthsWithSpend: 1,
      spendMonths: ['2026-07'],
      provisional: true,
    })
  })

  test('returns an empty average when none of the candidate months has household records', () => {
    expect(calculateAverage3({
      candidateMonths: ['2026-08', '2026-07', '2026-06'],
      transactionMonths: [],
      majorMonthlyAmounts: [],
      monthStatuses: [],
    })).toEqual({ amount: 0, months: [], monthsWithSpend: 0, spendMonths: [], provisional: false })
  })
})

describe('initialSource', () => {
  test('selects AI only when the saved job id and current recommendation amount both match', () => {
    const ai = row({ saved: { ...saved, amount: 250_000, recommendationJobId: 'job-1' } })
    expect(initialSource(ai, 'job-1', 250_000)).toBe('ai')
    expect(initialSource(ai, 'job-2', 250_000)).toBeNull()
    expect(initialSource(ai, 'job-1', 249_000)).toBeNull()
    expect(initialSource(ai, 'job-1')).toBeNull()
  })

  test('selects the first positive historical amount matching the saved value', () => {
    expect(initialSource(row({ saved: { ...saved, amount: 220_000 }, previousActual: {
      amount: 220_000, month: '2026-09', partial: null,
    }, average3: { amount: 220_000, months: ['2026-08'], monthsWithSpend: 1, provisional: false } }), null)).toBe('previousBudget')
    expect(initialSource(row({ saved: { ...saved, amount: 230_000 } }), null)).toBe('previousActual')
    expect(initialSource(row({ saved: { ...saved, amount: 210_000 } }), null)).toBe('average3')
  })

  test('does not select a zero-valued source', () => {
    expect(initialSource(row({
      saved: { ...saved, amount: 0, recommendationJobId: 'job-1' },
      previousBudget: 0,
      previousActual: { amount: 0, month: '2026-09', partial: null },
      average3: { amount: 0, months: [], monthsWithSpend: 0, provisional: false },
    }), 'job-1', 0)).toBeNull()
  })
})

test('differenceCaption distinguishes over, equal, and under budget', () => {
  expect(differenceCaption(131_700, 120_000)).toBe('+11,700 초과')
  expect(differenceCaption(380_000, 380_000)).toBe('예산과 같음')
  expect(differenceCaption(56_300, 120_000)).toBe('−63,700')
})
