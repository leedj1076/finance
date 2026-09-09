import { expect, test } from 'vitest'

import { buildAccountMonthly, buildCategoryMonthly, type MonthlyBreakdownRow } from '@/features/analytics/account-monthly'

test('keeps every payment account individually including small and refund-only cards', () => {
  const rows: MonthlyBreakdownRow[] = Array.from({ length: 8 }, (_, i) => ({
    date: '2026-01-10', flow: 'expense', accountName: `카드 ${i}`, major: `분류 ${i}`, amount: 1000 + i,
  }))
  rows.push(
    { date: '2026-01-10', flow: 'expense', accountName: 'DJ 현대 - 네이버', major: '분류 8', amount: 100 },
    { date: '2026-02-10', flow: 'expense', accountName: '환불 카드', major: '분류 9', amount: -50 },
  )
  const result = buildAccountMonthly(rows, 'expense', { fold: false })
  expect(result.accounts).toHaveLength(10)
  expect(result.folded).toBeUndefined()
  expect(result.accounts).not.toContain('그 외')
  expect(result.series['DJ 현대 - 네이버'].slice(0, 3)).toEqual([100, 0, null])
  expect(result.series['환불 카드'].slice(0, 3)).toEqual([0, -50, null])
  expect(Object.values(result.series).reduce((sum, values) => sum + (values[0] ?? 0), 0)).toBe(8128)
  // Other compact charts retain their existing folding contract.
  expect(buildAccountMonthly(rows, 'expense').folded).toBeDefined()
  expect(buildCategoryMonthly(rows, 'expense').folded).toBeDefined()
})
