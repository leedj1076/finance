import { describe, expect, test } from 'vitest'

import { calculateBudgetOverruns, calculateBudgetPace } from '@/features/budgets/pace'

describe('budget pace warnings', () => {
  const rows = [
    { major: '식비', group: 'variable', budget: 600_000, actual: 400_000 },
    { major: '주거', group: 'fixed', budget: 1_000_000, actual: 500_000 },
    { major: '여행', group: 'irregular', budget: 300_000, actual: 400_000 },
    { major: '문화', group: 'variable', budget: 100_000, actual: 20_000 },
  ]

  test('warns only when current-month spending materially outpaces elapsed time', () => {
    expect(calculateBudgetPace(rows, '2026-09', '2026-09-10')).toEqual([
      {
        major: '식비',
        budget: 600_000,
        actual: 400_000,
        projected: 1_200_000,
        overrun: 600_000,
        spentPercent: 400_000 / 600_000 * 100,
        progressPercent: 10 / 30 * 100,
      },
      {
        major: '주거',
        budget: 1_000_000,
        actual: 500_000,
        projected: 1_500_000,
        overrun: 500_000,
        spentPercent: 50,
        progressPercent: 10 / 30 * 100,
      },
    ])
  })

  test('excludes irregular accruals, small amounts, early days, and historical months', () => {
    expect(calculateBudgetPace(rows, '2026-08', '2026-09-10')).toEqual([])
    expect(calculateBudgetPace(rows, '2026-09', '2026-09-04')).toEqual([])
    expect(calculateBudgetPace(rows, '2026-09', '2026-09-10', { minimumAmount: 600_000 })).toEqual([])
  })

  test('does not warn when the projected month-end amount remains within budget', () => {
    expect(calculateBudgetPace([
      { major: '교통', group: 'variable', budget: 300_000, actual: 140_000 },
    ], '2026-09', '2026-09-15')).toEqual([])
  })
})

describe('completed budget overruns', () => {
  test('returns actual overruns ordered by the exceeded amount', () => {
    expect(calculateBudgetOverruns([
      { major: '식비', group: 'variable', budget: 600_000, actual: 650_000 },
      { major: '주거', group: 'fixed', budget: 1_000_000, actual: 1_300_000 },
      { major: '여행', group: 'irregular', budget: 300_000, actual: 400_000 },
      { major: '문화', group: 'variable', budget: 0, actual: 500_000 },
    ])).toEqual([
      { major: '주거', budget: 1_000_000, actual: 1_300_000, overrun: 300_000 },
      { major: '여행', budget: 300_000, actual: 400_000, overrun: 100_000 },
      { major: '식비', budget: 600_000, actual: 650_000, overrun: 50_000 },
    ])
  })
})
