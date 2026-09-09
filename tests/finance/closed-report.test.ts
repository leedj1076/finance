import { expect, test } from 'vitest'
import { buildAnnualReport } from '@/features/analytics/report'
import { parseCellTransactionParams } from '@/features/analytics/category-detail'

const rows = [
  { id: 1, date: '2026-01-01', flow: 'income' as const, amount: 1000, major: '급여', memo: null },
  { id: 2, date: '2026-01-02', flow: 'expense' as const, amount: 400, major: '식비', memo: '식사' },
  { id: 3, date: '2026-02-01', flow: 'expense' as const, amount: 999, major: '식비', memo: '식사' },
  { id: 4, date: '2025-01-01', flow: 'expense' as const, amount: 200, major: '식비', memo: '식사' },
  { id: 5, date: '2025-02-01', flow: 'expense' as const, amount: 700, major: '식비', memo: '식사' },
]

test('closed zero months count in the forecast denominator; open months are excluded on both sides of YoY', () => {
  const data = buildAnnualReport({ year: 2026, currentMonthKey: '2026-09', transactions: rows, assetBalances: [], eligibleMonths: [1, 3], previousComparable: true })
  expect(data.annual.expense).toBe(400)
  expect(data.previous.expense).toBe(200)
  expect(data.cashflow.completedMonthDivisor).toBe(2)
  expect(data.cashflow.monthlyNet).toBe(300)
  expect(data.topExpenses[0]).toMatchObject({ amount: 400, previous: 200, delta: 200 })
})

test('no closed months means no forecast; missing prior close suppresses comparisons even when prior data exists', () => {
  const empty = buildAnnualReport({ year: 2026, currentMonthKey: '2026-09', transactions: rows, assetBalances: [], eligibleMonths: [], previousComparable: false })
  expect(empty.cashflow.forecast).toEqual([])
  expect(empty.cashflow.completedMonthDivisor).toBe(0)
  expect(empty.annual.expense).toBe(0)
  const partial = buildAnnualReport({ year: 2026, currentMonthKey: '2026-09', transactions: rows, assetBalances: [], eligibleMonths: [1, 3], previousComparable: false })
  expect(partial.hasPrevious).toBe(false)
  expect(partial.previous.expense).toBe(0)
})

test('closed tooltip scope requires a nonnegative safe integer revision and never falls back to live', () => {
  const base = 'year=2026&month=1&flow=expense&major=식비&sub=식사'
  expect(parseCellTransactionParams(new URLSearchParams(`${base}&scope=closed&revision=2`))).toMatchObject({ scope: 'closed', revision: 2 })
  for (const suffix of ['scope=closed', 'scope=closed&revision=-1', 'scope=closed&revision=1.5', 'scope=closed&revision=', 'scope=oops']) {
    expect(parseCellTransactionParams(new URLSearchParams(`${base}&${suffix}`))).toBeNull()
  }
})
