import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { db } from '@/db/client'
import { budgets, categories, categoryMeta, households, importInbox, ledgerMonths, recurring, settings, transactions } from '@/db/schema'
import { readBudgetSnapshot } from '@/features/budget-recommendations/snapshot'
import type { BudgetInput } from '@/features/budget-recommendations/types'
import { readBudgetData } from '@/features/budgets/queries'

let own: string
let foreign: string
let food: number
let hidden: number
let incomeId: number
let postedRule: number
let dueRule: number
let finalRule: number
const now = new Date('2026-09-10T03:00:00Z')
const input: BudgetInput = {
  month: '2026-09', notes: '추가 비용 외 추정 금액 100만원은 확정 아님',
  plannedExpenses: [{ id: '00000000-0000-4000-8000-000000000001', major: '식비', amount: 25_000, note: '가족 모임' }],
  draftAmounts: [{ major: '식비', amount: 300_000 }],
}

beforeEach(async () => {
  const homes = await db.insert(households).values([{ name: 'TEST-budget-snapshot' }, { name: 'TEST-budget-snapshot-foreign' }]).returning()
  own = homes[0].id
  foreign = homes[1].id
  const cats = await db.insert(categories).values([
    { householdId: own, kind: 'expense' as const, major: '식비', sub: '장보기' },
    { householdId: own, kind: 'expense' as const, major: '식비', sub: '숨긴 식비', hidden: true },
    { householdId: own, kind: 'expense' as const, major: '숨김', sub: '숨김', hidden: true },
    { householdId: foreign, kind: 'expense' as const, major: '외부', sub: '비공개' },
  ]).returning()
  food = cats[0].id
  hidden = cats[2].id
  await db.insert(settings).values({ householdId: own, key: 'savings_target', value: '30' })
  await db.insert(budgets).values([
    { householdId: own, month: '*', major: '식비', amount: 200_000 },
    { householdId: own, month: '2026-08', major: '식비', amount: 180_000 },
    { householdId: own, month: '2026-09', major: '식비', amount: 250_000 },
  ])
  const rows = await db.insert(transactions).values([
    { householdId: own, date: '2026-01-02', flow: 'income' as const, amount: 1_000_000 },
    { householdId: own, date: '2026-02-02', flow: 'saving' as const, amount: 10_000 },
    { householdId: own, date: '2026-03-02', flow: 'expense' as const, amount: 60_000, categoryId: food },
    { householdId: own, date: '2026-08-02', flow: 'income' as const, amount: 2_000_000 },
    { householdId: own, date: '2026-08-03', flow: 'expense' as const, amount: 150_000, categoryId: food },
    { householdId: own, date: '2026-09-02', flow: 'expense' as const, amount: 100_000, categoryId: food },
    { householdId: own, date: '2026-09-03', flow: 'expense' as const, amount: -20_000, categoryId: food },
    { householdId: own, date: '2026-09-04', flow: 'expense' as const, amount: 50_000, categoryId: cats[1].id },
    { householdId: own, date: '2026-09-04', flow: 'expense' as const, amount: 30_000, categoryId: hidden },
    { householdId: own, date: '2026-09-04', flow: 'expense' as const, amount: 10_000 },
    { householdId: own, date: '2026-09-04', flow: 'saving' as const, amount: 70_000 },
    { householdId: own, date: '2026-09-04', flow: 'income' as const, amount: 500_000 },
    { householdId: foreign, date: '2026-09-04', flow: 'expense' as const, amount: 9_999_999, categoryId: cats[3].id },
    { householdId: foreign, date: '2026-01-04', flow: 'income' as const, amount: 9_999_999 },
  ]).returning()
  incomeId = rows[0].id
  const rules = await db.insert(recurring).values([
    { householdId: own, flow: 'expense' as const, categoryId: food, amount: 40_000, day: 6, adjustToBusinessDay: true },
    { householdId: own, flow: 'expense' as const, categoryId: food, amount: 90_000, day: 1 },
    { householdId: own, flow: 'expense' as const, categoryId: hidden, amount: 20_000, day: 2 },
    { householdId: own, flow: 'expense' as const, amount: 10_000, day: 3 },
    { householdId: own, flow: 'saving' as const, amount: 1_000_000 },
    { householdId: own, flow: 'income' as const, amount: 2_000_000 },
    { householdId: own, flow: 'expense' as const, categoryId: food, amount: 100_000, endMonth: '2026-08' },
    { householdId: own, flow: 'expense' as const, categoryId: food, amount: 100_000, startMonth: '2026-10' },
    { householdId: own, flow: 'expense' as const, categoryId: food, amount: 100_000, active: false },
    { householdId: own, flow: 'expense' as const, categoryId: food, amount: 15_000, day: 30,
      startMonth: '2026-07', endMonth: '2026-09', startOccurrence: 9, memo: '할부 X회' },
    { householdId: foreign, flow: 'expense' as const, amount: 9_999_999 },
  ]).returning()
  dueRule = rules[0].id
  postedRule = rules[1].id
  finalRule = rules[9].id
  await db.insert(transactions).values({ householdId: own, date: '2026-10-01', flow: 'expense',
    amount: 90_000, categoryId: food, recurringId: postedRule, importUid: `recurring:${postedRule}:2026-09` })
  await db.insert(ledgerMonths).values({ householdId: own, month: '2026-05', revision: 0,
    closedRevision: 0, closedAt: new Date('2026-06-01T00:00:00Z'), closedBy: randomUUID() })
  await db.insert(importInbox).values([
    { householdId: own, importUid: randomUUID(), owner: 'TEST', date: '2026-09-02', amount: 1, flow: 'expense' as const },
    { householdId: foreign, importUid: randomUUID(), owner: 'TEST', date: '2026-09-02', amount: 1, flow: 'expense' as const },
  ])
})

afterEach(async () => {
  for (const id of [own, foreign].filter(Boolean)) await db.delete(households).where(eq(households.id, id))
})

function snapshot(value = input, clock = now) {
  return db.transaction(tx => readBudgetSnapshot(tx, own, value, clock), { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

test('canonical income uses every recorded basis month and scoped signed expense floors retain hidden/null reserve', async () => {
  const s = await snapshot()
  const canonical = await readBudgetData(db, own, input.month, now)
  expect(s.basis).toEqual({ averageIncome: 750_000, savingsTarget: 30, spendCeiling: 525_000,
    incomeStart: '2026-01-01', incomeEnd: '2026-09-01', incomeMonthCount: 4 })
  expect(s.basis.spendCeiling).toBe(canonical.spendCeiling)
  expect(s.current).toEqual({ income: 500_000, expense: 170_000, saving: 70_000,
    unallocatedActual: 90_000, unallocatedRecurring: 30_000 })
  expect(s.rows).toHaveLength(1)
  expect(s.rows[0]).toMatchObject({ major: '식비', savedAmount: 250_000, savedRecommendationJobId: null,
    actual: 80_000, unpostedRecurring: 55_000, planned: 25_000, floor: 160_000,
    previousBudget: 180_000, previousActual: 150_000, average: 52_500, median: 105_000 })
  expect(s.evidenceCount).toEqual({ total: 10, provided: 10 })
  expect(s.evidence.some(row => row.major === '외부')).toBe(false)
  expect(s.pendingCount).toBe(1)
  expect(s.unclassifiedCount).toBe(3)
})

test('due expense obligations include overdue/final occurrence, business date and moved posting identity', async () => {
  const s = await snapshot()
  expect(s.recurring).toHaveLength(5)
  expect(s.recurring.find(row => row.id === dueRule)).toMatchObject({ date: '2026-09-04', posted: false, amount: 40_000 })
  expect(s.recurring.find(row => row.id === postedRule)).toMatchObject({ posted: true, amount: 90_000 })
  expect(s.recurring.find(row => row.id === finalRule)).toMatchObject({ date: '2026-09-30', memo: '할부 11회' })
  const next = await snapshot({ ...input, month: '2026-10' })
  expect(next.recurring.some(row => row.id === finalRule)).toBe(false)
})

test('hidden recurring subcategory sharing an active major reserves only unallocated funds until explicitly posted', async () => {
  const [hiddenFood] = await db.select().from(categories).where(and(
    eq(categories.householdId, own), eq(categories.major, '식비'), eq(categories.hidden, true),
  ))
  const [rule] = await db.insert(recurring).values({
    householdId: own, flow: 'expense', categoryId: hiddenFood.id, amount: 35_000, day: 2,
  }).returning()
  const unposted = await snapshot()
  expect(unposted.current.unallocatedRecurring).toBe(65_000)
  expect(unposted.rows[0]).toMatchObject({ major: '식비', unpostedRecurring: 55_000, floor: 160_000 })
  expect(unposted.recurring.find(row => row.id === rule.id)).toMatchObject({
    major: null, amount: 35_000, date: '2026-09-02', posted: false,
  })

  await db.insert(transactions).values({
    householdId: own, date: '2026-10-02', flow: 'expense', categoryId: hiddenFood.id,
    amount: 35_000, recurringId: rule.id, importUid: `recurring:${rule.id}:2026-09`,
  })
  const posted = await snapshot()
  expect(posted.current.unallocatedRecurring).toBe(30_000)
  expect(posted.rows[0]).toMatchObject({ major: '식비', unpostedRecurring: 55_000, floor: 160_000 })
  expect(posted.recurring.find(row => row.id === rule.id)).toMatchObject({ major: null, amount: 35_000, posted: true })
})

test('six calendar months distinguish missing open, closed zero, sparse records and the current partial month', async () => {
  const s = await snapshot()
  expect(s.history.map(row => row.month)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'])
  expect(s.history[0]).toMatchObject({ hasRecords: true, expense: 60_000, partial: false })
  expect(s.history[1]).toMatchObject({ hasRecords: false, state: 'open', expense: 0 })
  expect(s.history[2]).toMatchObject({ hasRecords: false, state: 'closed', expense: 0 })
  const next = await snapshot({ ...input, month: '2026-10' })
  expect(next.history[5]).toMatchObject({ month: '2026-09', partial: true, expense: 170_000 })
})

test('source hashes use KST day and month revision while budget/notes/draft edits have separate hashes', async () => {
  const s = await snapshot()
  expect((await snapshot(input, new Date('2026-09-10T14:59:59Z'))).fingerprint).toBe(s.fingerprint)
  expect((await snapshot(input, new Date('2026-09-10T15:00:00Z'))).sourceHash).not.toBe(s.sourceHash)
  await db.update(budgets).set({ amount: 260_000 }).where(and(eq(budgets.householdId, own), eq(budgets.month, '2026-09')))
  const changedBudget = await snapshot()
  expect(changedBudget.sourceHash).toBe(s.sourceHash)
  expect(changedBudget.budgetHash).not.toBe(s.budgetHash)
  for (const edit of [
    { ...input, notes: '새 메모' },
    { ...input, draftAmounts: [{ major: '식비', amount: 310_000 }] },
    { ...input, plannedExpenses: [{ ...input.plannedExpenses[0], amount: 30_000 }] },
  ]) {
    const editedInput = await snapshot(edit)
    expect(editedInput.sourceHash).toBe(changedBudget.sourceHash)
    expect(editedInput.budgetHash).toBe(changedBudget.budgetHash)
    expect(editedInput.fingerprint).not.toBe(changedBudget.fingerprint)
  }
  const requestWithId = { ...input, requestId: randomUUID() }
  expect((await snapshot(requestWithId)).fingerprint).toBe(changedBudget.fingerprint)
  await db.update(ledgerMonths).set({ revision: 1 }).where(and(eq(ledgerMonths.householdId, own), eq(ledgerMonths.month, '2026-05')))
  expect((await snapshot()).sourceHash).not.toBe(changedBudget.sourceHash)
})

test('out-of-window income basis and expense-only denominator edits invalidate source', async () => {
  const s = await snapshot()
  await db.update(transactions).set({ memo: 'basis evidence changed' }).where(eq(transactions.id, incomeId))
  const edited = await snapshot()
  expect(edited.sourceHash).not.toBe(s.sourceHash)
  expect(edited.basis).toEqual(s.basis)
  await db.delete(transactions).where(and(eq(transactions.householdId, own), eq(transactions.date, '2026-02-02')))
  const removed = await snapshot()
  expect(removed.basis.averageIncome).toBe(1_000_000)
  expect(removed.sourceHash).not.toBe(edited.sourceHash)
})

test('omitted transaction edits change source without truncating aggregates', async () => {
  const added = await db.insert(transactions).values(Array.from({ length: 2100 }, (_, i) => ({
    householdId: own, date: '2026-09-05', flow: 'expense' as const, amount: i < 1000 ? 10 : 1, categoryId: food,
  }))).returning({ id: transactions.id })
  const s = await snapshot()
  expect(s.evidenceCount.total).toBe(2110)
  expect(s.evidenceCount.provided).toBeLessThanOrEqual(2000)
  expect(s.current.expense).toBe(181_100)
  const provided = new Set(s.evidence.map(row => row.id))
  const omitted = added.find(row => !provided.has(row.id))!
  expect(omitted).toBeDefined()
  const [status] = await db.select().from(ledgerMonths)
    .where(and(eq(ledgerMonths.householdId, own), eq(ledgerMonths.month, input.month)))
  await db.update(transactions).set({ memo: 'changed omitted evidence' }).where(eq(transactions.id, omitted.id))
  // Keep the fixture's status stable to prove the complete transaction digest,
  // rather than only the transaction trigger's revision bump, detects the edit.
  await db.update(ledgerMonths).set({ revision: status.revision })
    .where(and(eq(ledgerMonths.householdId, own), eq(ledgerMonths.month, input.month)))
  const edited = await snapshot()
  expect(edited.current).toEqual(s.current)
  expect(edited.sourceHash).not.toBe(s.sourceHash)
  expect(edited.evidence).toEqual(s.evidence)
})

test('canonical pace and both snapshot readers respect supplied clock across a KST month boundary', async () => {
  const early = await readBudgetData(db, own, '2026-09', new Date('2026-09-04T15:00:00Z'))
  expect(early.paceWarnings[0]).toMatchObject({ major: '식비', projected: 780_000, overrun: 530_000 })
  const october = await readBudgetData(db, own, '2026-09', new Date('2026-09-30T15:00:00Z'))
  expect(october.paceWarnings).toEqual([])
  const s = await snapshot(input, new Date('2026-08-31T15:00:00Z'))
  expect(s.asOfDate).toBe('2026-09-01')
  expect(s.basis.incomeEnd).toBe('2026-09-01')
  expect(s.history[5].partial).toBe(false)
  const january = await snapshot({ ...input, month: '2027-01' }, new Date('2026-12-10T00:00:00Z'))
  expect(january.basis.averageIncome).toBe(0)
  expect(january.basis.spendCeiling).toBe(0)
})

test('category metadata and posting identity changes invalidate source, foreign changes do not', async () => {
  const s = await snapshot()
  await db.update(transactions).set({ memo: 'foreign edit' }).where(eq(transactions.householdId, foreign))
  expect((await snapshot()).sourceHash).toBe(s.sourceHash)
  await db.insert(categoryMeta).values({ householdId: own, major: '식비', irregular: true })
  const metadata = await snapshot()
  expect(metadata.sourceHash).not.toBe(s.sourceHash)
  await db.update(transactions).set({ importUid: `recurring:${postedRule}:2026-10` }).where(and(eq(transactions.householdId, own), eq(transactions.recurringId, postedRule)))
  const unposted = await snapshot()
  expect(unposted.sourceHash).not.toBe(metadata.sourceHash)
  expect(unposted.rows[0].unpostedRecurring).toBe(145_000)
})

test('supplied repeatable-read reader preserves one snapshot despite concurrent committed changes', async () => {
  await db.transaction(async tx => {
    const first = await readBudgetSnapshot(tx, own, input, now)
    await db.update(transactions).set({ amount: sql`${transactions.amount} + 1` })
      .where(and(eq(transactions.householdId, own), inArray(transactions.id, [incomeId])))
    expect(await readBudgetSnapshot(tx, own, input, now)).toEqual(first)
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
})

test('planned costs cannot target a hidden major', async () => {
  await expect(snapshot({ ...input, plannedExpenses: [{ ...input.plannedExpenses[0], major: '숨김' }] })).rejects.toThrow()
})

test.each(['2026-09', '*', '2026-08'])('rejects unsafe saved/effective budget from %s', async month => {
  await db.update(budgets).set({ amount: Number.MAX_SAFE_INTEGER + 1 })
    .where(and(eq(budgets.householdId, own), eq(budgets.month, month)))
  await expect(snapshot()).rejects.toThrow('invalid_amount')
})

test('rejects an unsafe posted rule amount even though it contributes no reserve', async () => {
  await db.update(recurring).set({ amount: Number.MAX_SAFE_INTEGER + 1 }).where(eq(recurring.id, postedRule))
  await expect(snapshot()).rejects.toThrow('invalid_amount')
})

test.each(['2026-09-03', '2026-01-03'])('rejects canceling unsafe source transactions on %s even outside evidence', async date => {
  await db.insert(transactions).values([
    { householdId: own, date, flow: 'expense', categoryId: food, amount: Number.MAX_SAFE_INTEGER + 1 },
    { householdId: own, date, flow: 'expense', categoryId: food, amount: Number.MIN_SAFE_INTEGER - 1 },
  ])
  await expect(snapshot()).rejects.toThrow('invalid_amount')
})

test('rejects an unsafe canonical basis aggregate even when individual rows and the divided income are safe', async () => {
  await db.update(transactions).set({ amount: Number.MAX_SAFE_INTEGER }).where(eq(transactions.id, incomeId))
  await db.insert(transactions).values({ householdId: own, date: '2026-02-03', flow: 'income', amount: Number.MAX_SAFE_INTEGER })
  await expect(snapshot()).rejects.toThrow('invalid_amount')
})
