import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { budgets, categories, households, settings } from '@/db/schema'
import { saveBudgetPlan } from '@/features/budgets/actions'
import { saveBudgetReview } from '@/features/budgets/review-actions'
import { readBudgetBaselines } from '@/features/budgets/save-service'

const context = vi.hoisted(() => ({ householdId: '' }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => context }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let foreignId: string

beforeEach(async () => {
  const [own, foreign] = await db.insert(households).values([
    { name: 'TEST-budget-save' }, { name: 'TEST-budget-save-foreign' },
  ]).returning()
  context.householdId = own.id
  foreignId = foreign.id
  await db.insert(categories).values([
    { householdId: own.id, kind: 'expense', major: '식비', sub: '장보기' },
    { householdId: own.id, kind: 'expense', major: '교통', sub: '버스' },
  ])
  await db.insert(budgets).values([
    { householdId: foreign.id, month: '2026-07', major: '식비', amount: 111 },
    { householdId: own.id, month: '2026-07', major: '교통', amount: 222 },
  ])
})

afterEach(async () => {
  for (const id of [context.householdId, foreignId]) {
    await db.delete(households).where(eq(households.id, id))
  }
})

async function budgetForm(amount: number, target: number | null = null) {
  const baseline = await readBudgetBaselines(db, context.householdId, '2026-07')
  const form = new FormData()
  form.set('payload', JSON.stringify({ month: '2026-07',
    changes: [{ major: '식비', amount, recommendationJobId: null, expectedVersion: baseline.rows.find(row => row.major === '식비')!.version }],
    targetChange: target === null ? null : { value: target, expectedVersion: baseline.targetVersion }, acknowledgeOverage: true }))
  return form
}

test('returns the save result inline after persisting an exact won amount for only this household', async () => {
  await expect(saveBudgetPlan({}, await budgetForm(723693))).resolves.toMatchObject({ saved: { total: 723915, rows: expect.arrayContaining([
    expect.objectContaining({ major: '식비', amount: 723693 }), expect.objectContaining({ major: '교통', amount: 222 }),
  ]) } })
  expect(await db.select({ month: budgets.month, amount: budgets.amount }).from(budgets)
    .where(eq(budgets.householdId, context.householdId))).toEqual(expect.arrayContaining([{ month: '2026-07', amount: 723693 }, { month: '2026-07', amount: 222 }]))
  expect(await db.select({ value: settings.value }).from(settings)
    .where(eq(settings.householdId, context.householdId))).toEqual([])
  expect(await db.select({ amount: budgets.amount }).from(budgets)
    .where(eq(budgets.householdId, foreignId))).toEqual([{ amount: 111 }])
})

test.each([-1, 723693.5])('rejects invalid budget %s without saving', async (amount) => {
  expect(await saveBudgetPlan({}, await budgetForm(amount, 40))).toHaveProperty('error')
  expect(await db.select({ major: budgets.major, amount: budgets.amount }).from(budgets).where(eq(budgets.householdId, context.householdId)))
    .toEqual([{ major: '교통', amount: 222 }])
  expect(await db.select().from(settings).where(eq(settings.householdId, context.householdId))).toEqual([])
})

test('explicit target saves the setting and returns its new authoritative version', async () => {
  const before = await readBudgetBaselines(db, context.householdId, '2026-07')
  const result = await saveBudgetPlan({}, await budgetForm(723693, 40))
  expect(result).toMatchObject({ saved: { savingsTarget: 40 } })
  expect(result.saved?.targetVersion).not.toBe(before.targetVersion)
  expect(await db.select({ value: settings.value }).from(settings).where(eq(settings.householdId, context.householdId))).toEqual([{ value: '40' }])
})
test('stale action response has a recoverable conflict code and preserves committed values', async () => {
  const stale = await budgetForm(700000)
  await saveBudgetPlan({}, await budgetForm(723693))
  expect(await saveBudgetPlan({}, stale)).toMatchObject({ code: 'budget_conflict', error: expect.any(String) })
  expect((await readBudgetBaselines(db, context.householdId, '2026-07')).rows.find(row => row.major === '식비')?.amount).toBe(723693)
})
test('obsolete review form writes nothing and new review payload uses the same guarded path', async () => {
  const obsolete = new FormData()
  obsolete.set('targetMonth', '2026-07'); obsolete.set('budget:식비', '999')
  expect(await saveBudgetReview({}, obsolete)).toMatchObject({ error: '예산 화면을 새로 열어 변경사항을 확인해 주세요.' })
  expect((await readBudgetBaselines(db, context.householdId, '2026-07')).rows.find(row => row.major === '식비')?.amount).toBe(0)
  expect(await saveBudgetReview({}, await budgetForm(723693))).toMatchObject({ saved: { total: 723915 } })
})
