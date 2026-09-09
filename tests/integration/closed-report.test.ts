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
  ])
})
afterEach(async () => { await db.delete(households).where(eq(households.id, householdId)) })
async function close(month: string) {
  const summary = await getMonthCloseSummary(householdId, month)
  expect(await closeMonth(householdId, randomUUID(), { month, revision: summary.revision, acknowledgeWarnings: true, acknowledgeEmpty: true })).toEqual({ ok: true })
  return summary
}

test('all report blocks share explicit closed eligibility, including zero months and exact prior-year matches', async () => {
  await db.insert(settings).values({ householdId, key: 'savings_target', value: '65' })
  expect((await getStatsReportData(householdId, 2026)).eligibleMonths).toEqual([])
  await close('2026-01'); await close('2026-03')
  const data = await getStatsReportData(householdId, 2026)
  expect(data.savingsTarget).toBe(65)
  expect(data.targetHitMonths).toBe(0)
  expect(data.eligibleMonths).toEqual([1, 3])
  expect(data.report.annual.expense).toBe(400)
  expect(data.report.cashflow.monthlyNet).toBe(300)
  expect(data.monthly[1].active).toBe(false)
  expect(data.monthly[2].active).toBe(true)
  expect(data.details.expense.closedMonths).toEqual([1, 3])
  expect(data.details.expense.divisor).toBe(2)
  expect(data.accountMonthly.expense.series['(미지정)'].slice(0, 3)).toEqual([400, null, 0])
  expect(data.previousComparable).toBe(false)
  await close('2025-01')
  expect((await getStatsReportData(householdId, 2026)).previousComparable).toBe(false)
  await close('2025-03')
  const comparable = await getStatsReportData(householdId, 2026)
  expect(comparable.previousComparable).toBe(true)
  expect(comparable.report.previous.expense).toBe(200)
  expect(comparable.report.topMerchants[0].amount).toBe(400)
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
  expect((await getStatsReportData(randomUUID(), 2026)).eligibleMonths).toEqual([])
})
