import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { budgets, categories, households, ledgerMonths, transactions } from '@/db/schema'
import { getBudgetPlanningData } from '@/features/budgets/planning-queries'

for (const name of ['DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'] as const) {
  const value = process.env[name]
  if (!value || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
    throw new Error('Budget plan source tests require local Supabase')
  }
}

let own = ''
let foreign = ''
let food = 0

beforeAll(async () => {
  const homes = await db.insert(households).values([
    { name: 'TEST-budget-plan-sources' },
    { name: 'TEST-budget-plan-sources-foreign' },
  ]).returning()
  own = homes[0].id
  foreign = homes[1].id
  const rows = await db.insert(categories).values([
    { householdId: own, kind: 'expense', major: '식비', sub: '장보기' },
    { householdId: foreign, kind: 'expense', major: '식비', sub: '외부' },
  ]).returning()
  food = rows[0].id
})

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-11T03:00:00Z'))
  await db.delete(transactions).where(inArray(transactions.householdId, [own, foreign]))
  await db.delete(budgets).where(inArray(budgets.householdId, [own, foreign]))
  await db.insert(budgets).values([
    { householdId: own, month: '*', major: '식비', amount: 100_000 },
    { householdId: own, month: '2026-09', major: '식비', amount: 120_000 },
    { householdId: own, month: '2026-10', major: '식비', amount: 130_000 },
    { householdId: foreign, month: '2026-10', major: '식비', amount: 9_999_999 },
  ])
  const foreignFood = (await db.select().from(categories).where(eq(categories.householdId, foreign)))[0].id
  await db.insert(transactions).values([
    { householdId: own, date: '2026-08-02', flow: 'expense', amount: 300, categoryId: food },
    { householdId: own, date: '2026-07-02', flow: 'income', amount: 1_000 },
    { householdId: own, date: '2026-06-02', flow: 'expense', amount: 200, categoryId: food },
    { householdId: own, date: '2026-05-02', flow: 'expense', amount: 9_000, categoryId: food },
    { householdId: own, date: '2026-09-02', flow: 'expense', amount: 150, categoryId: food },
    { householdId: foreign, date: '2026-08-02', flow: 'expense', amount: 9_999_999, categoryId: foreignFood },
  ])
  const statuses = await db.select().from(ledgerMonths).where(and(
    eq(ledgerMonths.householdId, own), inArray(ledgerMonths.month, ['2026-06', '2026-07']),
  ))
  for (const status of statuses) {
    await db.update(ledgerMonths).set({
      closedRevision: status.revision,
      closedAt: new Date('2026-09-01T00:00:00Z'),
      closedBy: randomUUID(),
    }).where(and(eq(ledgerMonths.householdId, own), eq(ledgerMonths.month, status.month)))
  }
})

afterAll(async () => {
  vi.useRealTimers()
  for (const id of [own, foreign].filter(Boolean)) await db.delete(households).where(eq(households.id, id))
})

test('planning rows use three ended record months, close status, baseline versions, and scoped previous actual', async () => {
  const planning = await getBudgetPlanningData(own, '2026-10')

  expect(planning.planRows).toHaveLength(1)
  expect(planning.planRows[0]).toEqual({
    major: '식비',
    group: 'variable',
    saved: {
      amount: 130_000,
      recommendationJobId: null,
      version: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
    actual: 0,
    previousBudget: 120_000,
    previousActual: { amount: 150, month: '2026-09', partial: { asOf: '2026-09-11' } },
    average3: {
      amount: 167,
      months: ['2026-08', '2026-07', '2026-06'],
      monthsWithSpend: 2,
      spendMonths: ['2026-08', '2026-06'],
      provisional: true,
    },
  })
})
