import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { db } from '@/db/client'
import { categories, households, settings, transactions } from '@/db/schema'
import { getStatsReportData } from '@/features/analytics/stats-report'
import { getCellTransactions } from '@/features/analytics/category-detail'
import { getMonthCloseSummary } from '@/features/month-close/queries'
import { closeMonth } from '@/features/month-close/service'

let householdId: string
let categoryId: number
beforeEach(async () => {
  const [household] = await db.insert(households).values({ name: 'TEST-closed-report' }).returning()
  householdId = household.id
  const [category] = await db.insert(categories).values({ householdId, kind: 'expense', major: '식비', sub: '식사' }).returning()
  categoryId = category.id
  await db.insert(transactions).values([
    { householdId, date: '2026-01-01', flow: 'income', amount: 1000 },
    { householdId, date: '2026-01-02', flow: 'expense', amount: 400, categoryId, memo: '식사' },
    { householdId, date: '2026-02-01', flow: 'expense', amount: 999, categoryId },
    { householdId, date: '2025-01-01', flow: 'expense', amount: 200, categoryId },
    { householdId, date: '2025-02-01', flow: 'expense', amount: 700, categoryId },
  ])
})
afterEach(async () => { await db.delete(households).where(eq(households.id, householdId)) })
async function close(month: string) {
  const summary = await getMonthCloseSummary(householdId, month)
  expect(await closeMonth(householdId, randomUUID(), { month, revision: summary.revision, acknowledgeWarnings: true, acknowledgeEmpty: true })).toEqual({ ok: true })
  return summary
}

test('statistics compute official and provisional results from closed and recorded ended months', async () => {
  await db.insert(settings).values({ householdId, key: 'savings_target', value: '65' })
  const before = await getStatsReportData(householdId, 2026, { currentMonthKey: '2026-09' })
  expect(before.closedMonths).toEqual([])
  expect(before.endedMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  expect(before.recordedMonths).toEqual([1, 2])
  expect(before.provisionalMonths).toEqual([1, 2])
  expect(before.hasTransactions).toBe(true)
  expect(before.report.official.annual.expense).toBe(0)
  expect(before.report.provisional.annual.expense).toBe(1399)
  expect(before.monthly[1]).toMatchObject({ expense: 999, state: 'open', active: true, hasTransactions: true })
  expect(before.monthly[2]).toMatchObject({ expense: 0, state: 'open', active: true, hasTransactions: false })
  expect(before.monthStates.slice(7, 10)).toEqual(['open', 'current', 'future'])
  expect(before.previousComparable).toBe(false)
  expect(before.previousEndedComparable).toBe(true)
  expect(before.report.provisional.previous.expense).toBe(900)

  await close('2026-01'); await close('2026-03')
  const data = await getStatsReportData(householdId, 2026, { currentMonthKey: '2026-09' })
  expect(data.savingsTarget).toBe(65)
  expect(data.targetHitMonths).toBe(0)
  expect(data.provisionalTargetHitMonths).toBe(0)
  expect(data.closedMonths).toEqual([1, 3])
  expect(data.provisionalMonths).toEqual([1, 2, 3])
  expect(data.monthStates.slice(0, 3)).toEqual(['closed', 'open', 'closed'])
  expect(data.report.official.annual.expense).toBe(400)
  expect(data.report.official.cashflow.monthlyNet).toBe(300)
  expect(data.report.provisional.annual.expense).toBe(1399)
  expect(data.details.expense.closedMonths).toEqual([1, 3])
  expect(data.details.expense.divisor).toBe(2)
  expect(data.details.expense.recordedMonths).toEqual([1, 2])
  expect(data.details.expense.provisionalMonths).toEqual([1, 2, 3])
  expect(data.details.expense.provisionalDivisor).toBe(3)
  expect(data.details.expense.groups[0].subs[0].months.slice(0, 3)).toEqual([400, 999, 0])
  expect(data.accountMonthly.expense.series['(미지정)'].slice(0, 4)).toEqual([400, 999, 0, null])
  expect(data.previousComparable).toBe(false)
  expect(data.previousEndedComparable).toBe(false)
  await close('2025-01')
  expect((await getStatsReportData(householdId, 2026, { currentMonthKey: '2026-09' })).previousComparable).toBe(false)
  await close('2025-03')
  const comparable = await getStatsReportData(householdId, 2026, { currentMonthKey: '2026-09' })
  expect(comparable.previousComparable).toBe(true)
  expect(comparable.previousEndedComparable).toBe(true)
  expect(comparable.report.official.previous.expense).toBe(200)
  expect(comparable.report.provisional.previous.expense).toBe(900)
  expect(comparable.report.official.topMerchants[0].amount).toBe(400)
})

test('transaction presence distinguishes refunds, net zero, current activity, empty open months, and closed zero', async () => {
  await db.insert(transactions).values([
    { householdId, date: '2026-04-01', flow: 'expense', amount: -50, categoryId },
    { householdId, date: '2026-05-01', flow: 'expense', amount: 50, categoryId },
    { householdId, date: '2026-05-02', flow: 'expense', amount: -50, categoryId },
    { householdId, date: '2026-09-01', flow: 'income', amount: 500 },
  ])
  await close('2026-07')

  const data = await getStatsReportData(householdId, 2026, { currentMonthKey: '2026-09' })
  expect(data.recordedMonths).toEqual([1, 2, 4, 5, 9])
  expect(data.provisionalMonths).toEqual([1, 2, 4, 5, 7])
  expect(data.details.expense.provisionalDivisor).toBe(5)
  expect(data.monthly[3]).toMatchObject({ expense: -50, hasTransactions: true, active: true, state: 'open' })
  expect(data.monthly[4]).toMatchObject({ expense: 0, hasTransactions: true, active: true, state: 'open' })
  expect(data.monthly[5]).toMatchObject({ expense: 0, hasTransactions: false, active: true, state: 'open' })
  expect(data.monthly[6]).toMatchObject({ expense: 0, hasTransactions: false, active: true, state: 'closed' })
  expect(data.monthly[8]).toMatchObject({ income: 500, hasTransactions: true, active: true, state: 'current' })
  expect(data.report.provisional.annual.income).toBe(1000)
  expect(data.accountMonthly.expense.series['(미지정)'].slice(3, 8)).toEqual([-50, 0, null, 0, null])
})

test('closed cell requests reject invalidated revisions while live scope retains the ledger rows', async () => {
  const summary = await close('2026-01')
  const params = { flow: 'expense' as const, year: 2026, month: 1, major: '식비', sub: '식사', scope: 'closed' as const, revision: summary.revision }
  expect((await getCellTransactions(householdId, params)).total).toBe(400)
  await db.update(transactions).set({ amount: 450 }).where(and(eq(transactions.householdId, householdId), eq(transactions.date, '2026-01-02')))
  await expect(getCellTransactions(householdId, params)).rejects.toThrow('마감')
  expect((await getCellTransactions(householdId, { ...params, scope: 'live' })).total).toBe(450)
  await close('2026-01')
  await expect(getCellTransactions(householdId, params)).rejects.toThrow('마감')
  const empty = await getStatsReportData(randomUUID(), 2026, { currentMonthKey: '2026-09' })
  expect(empty.closedMonths).toEqual([])
  expect(empty.hasTransactions).toBe(false)
})
