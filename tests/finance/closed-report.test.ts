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

test('the same rows yield official and provisional reports that only differ by eligibility', () => {
  const official = buildAnnualReport({ year: 2026, currentMonthKey: '2026-09', transactions: rows, assetBalances: [], eligibleMonths: [1], previousComparable: false })
  const provisional = buildAnnualReport({ year: 2026, currentMonthKey: '2026-09', transactions: rows, assetBalances: [], eligibleMonths: [1, 2], previousComparable: true })
  expect(official.annual.expense).toBe(400)
  expect(official.hasPrevious).toBe(false)
  expect(provisional.annual.expense).toBe(1399)
  expect(provisional.hasPrevious).toBe(true)
  expect(provisional.previous.expense).toBe(900)
  expect(provisional.cashflow.completedMonthDivisor).toBe(2)
})

test('comparison metadata stays uncapped when official and provisional rankings diverge', () => {
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota']
  const rankedRows = names.flatMap((name, index) => [
    { id: index + 1, date: '2026-01-01', flow: 'expense' as const, amount: 100 - index, major: `Closed ${name}`, memo: `Closed Shop ${name}` },
    { id: index + 20, date: '2026-02-01', flow: 'expense' as const, amount: 1000 - index, major: `Open ${name}`, memo: `Open Shop ${name}` },
  ])
  rankedRows.push({ id: 50, date: '2025-01-01', flow: 'expense', amount: 40, major: 'Closed Alpha', memo: 'Closed Shop Alpha' })

  const official = buildAnnualReport({ year: 2026, currentMonthKey: '2026-09', transactions: rankedRows, assetBalances: [], eligibleMonths: [1], previousComparable: true })
  const provisional = buildAnnualReport({ year: 2026, currentMonthKey: '2026-09', transactions: rankedRows, assetBalances: [], eligibleMonths: [1, 2], previousComparable: true })

  expect(official.topExpenses).toHaveLength(6)
  expect(official.topMerchants).toHaveLength(8)
  expect(Object.keys(official.expenseComparisons)).toHaveLength(9)
  expect(Object.keys(official.merchantComparisons)).toHaveLength(9)
  expect(official.expenseComparisons['Closed Alpha']).toEqual({ amount: 100, previous: 40, delta: 60 })
  expect(official.merchantComparisons.closedshopalpha).toEqual({ amount: 100, previous: 40, delta: 60 })
  expect(provisional.topExpenses.some((row) => row.major === 'Closed Alpha')).toBe(false)
  expect(provisional.topMerchants.some((row) => row.name === 'Closed Shop Alpha')).toBe(false)
  expect(provisional.expenseComparisons['Closed Alpha']).toEqual({ amount: 100, previous: 40, delta: 60 })
  expect(provisional.merchantComparisons.closedshopalpha).toEqual({ amount: 100, previous: 40, delta: 60 })
})

test('closed tooltip scope requires a nonnegative safe integer revision and never falls back to live', () => {
  const base = 'year=2026&month=1&flow=expense&major=식비&sub=식사'
  expect(parseCellTransactionParams(new URLSearchParams(`${base}&scope=closed&revision=2`))).toMatchObject({ scope: 'closed', revision: 2 })
  for (const suffix of ['scope=closed', 'scope=closed&revision=-1', 'scope=closed&revision=1.5', 'scope=closed&revision=', 'scope=oops']) {
    expect(parseCellTransactionParams(new URLSearchParams(`${base}&${suffix}`))).toBeNull()
  }
})
