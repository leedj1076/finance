import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { budgets, categories, households, settings } from '@/db/schema'
import { saveBudgetPlan } from '@/features/budgets/actions'

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
  await db.insert(categories).values({ householdId: own.id, kind: 'expense', major: '식비', sub: '장보기' })
  await db.insert(budgets).values({ householdId: foreign.id, month: '2026-07', major: '식비', amount: 111 })
})

afterEach(async () => {
  for (const id of [context.householdId, foreignId]) {
    await db.delete(households).where(eq(households.id, id))
  }
})

function budgetForm(amount: string) {
  const form = new FormData()
  form.set('month', '2026-07')
  form.set('savingsTarget', '30')
  form.set('budget:식비', amount)
  return form
}

test('returns the save result inline after persisting an exact won amount for only this household', async () => {
  await expect(saveBudgetPlan({}, budgetForm('723693'))).resolves.toEqual({})
  expect(await db.select({ month: budgets.month, amount: budgets.amount }).from(budgets)
    .where(eq(budgets.householdId, context.householdId))).toEqual([{ month: '2026-07', amount: 723693 }])
  expect(await db.select({ value: settings.value }).from(settings)
    .where(eq(settings.householdId, context.householdId))).toEqual([{ value: '30' }])
  expect(await db.select({ amount: budgets.amount }).from(budgets)
    .where(eq(budgets.householdId, foreignId))).toEqual([{ amount: 111 }])
})

test.each(['-1', '723693.5'])('rejects invalid budget %s without saving', async (amount) => {
  expect(await saveBudgetPlan({}, budgetForm(amount))).toHaveProperty('error')
  expect(await db.select().from(budgets).where(eq(budgets.householdId, context.householdId))).toEqual([])
  expect(await db.select().from(settings).where(eq(settings.householdId, context.householdId))).toEqual([])
})
