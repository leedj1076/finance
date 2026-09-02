import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { categories, categoryRules, households, transactions } from '@/db/schema'
import { bulkClassifyTransactions } from '@/features/manage/actions'

const context = vi.hoisted(() => ({ householdId: '' }))

vi.mock('@/lib/household', () => ({
  requireHousehold: async () => ({
    userId: 'bulk-classify-test-user',
    householdId: context.householdId,
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) },
}))

const householdIds: string[] = []
const transactionIds: number[] = []
let foreignTransactionId: number
let expenseCategoryId: number
let incomeCategoryId: number

beforeAll(async () => {
  const created = await db
    .insert(households)
    .values([{ name: 'TEST-bulk-current' }, { name: 'TEST-bulk-other' }])
    .returning({ id: households.id })
  householdIds.push(...created.map((row) => row.id))
  context.householdId = householdIds[0]

  const categoryRows = await db
    .insert(categories)
    .values([
      { householdId: context.householdId, kind: 'expense', major: '식비', sub: '외식' },
      { householdId: context.householdId, kind: 'income', major: '월급', sub: '급여' },
      { householdId: householdIds[1], kind: 'expense', major: '타가구', sub: '비밀' },
    ])
    .returning({ id: categories.id, householdId: categories.householdId, kind: categories.kind })
  expenseCategoryId = categoryRows.find((row) => row.householdId === context.householdId && row.kind === 'expense')!.id
  incomeCategoryId = categoryRows.find((row) => row.householdId === context.householdId && row.kind === 'income')!.id

  const currentRows = await db
    .insert(transactions)
    .values([
      { householdId: context.householdId, date: '2026-08-01', flow: 'expense', memo: '동네식당', rawMerchant: '동네식당', amount: 12000 },
      { householdId: context.householdId, date: '2026-08-02', flow: 'income', memo: '회사급여', rawMerchant: '회사급여', amount: 3000000 },
      { householdId: context.householdId, date: '2026-08-03', flow: 'expense', memo: '분류오류검증', amount: 9000 },
    ])
    .returning({ id: transactions.id })
  transactionIds.push(...currentRows.map((row) => row.id))
  const [foreignRow] = await db
    .insert(transactions)
    .values({ householdId: householdIds[1], date: '2026-08-01', flow: 'expense', memo: '타가구거래', amount: 777 })
    .returning({ id: transactions.id })
  foreignTransactionId = foreignRow.id
})

afterAll(async () => {
  if (householdIds.length > 0) await db.delete(households).where(inArray(households.id, householdIds))
})

test('rejects a category whose kind differs from the selected transaction flow', async () => {
  const formData = new FormData()
  formData.set('ids', String(transactionIds[2]))
  formData.set(`category_${transactionIds[2]}`, String(incomeCategoryId))
  await expect(bulkClassifyTransactions(formData)).rejects.toThrow('REDIRECT:/manage?tab=unclassified&error=')

  const [row] = await db
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(and(eq(transactions.householdId, context.householdId), eq(transactions.id, transactionIds[2])))
  expect(row.categoryId).toBeNull()
})

test('cannot classify a transaction from another household', async () => {
  const formData = new FormData()
  formData.set('ids', String(foreignTransactionId))
  formData.set(`category_${foreignTransactionId}`, String(expenseCategoryId))
  await expect(bulkClassifyTransactions(formData)).rejects.toThrow('REDIRECT:/manage?tab=unclassified&error=')

  const foreignRows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdIds[1]),
        eq(transactions.id, foreignTransactionId),
        isNull(transactions.categoryId),
      ),
    )
  expect(foreignRows).toHaveLength(1)
})

test('bulk classifies selected rows and learns merchant rules', async () => {
  const formData = new FormData()
  formData.append('ids', String(transactionIds[0]))
  formData.append('ids', String(transactionIds[1]))
  formData.set(`category_${transactionIds[0]}`, String(expenseCategoryId))
  formData.set(`category_${transactionIds[1]}`, String(incomeCategoryId))
  formData.set(`fixed_${transactionIds[0]}`, 'on')
  await expect(bulkClassifyTransactions(formData)).rejects.toThrow('REDIRECT:/manage?tab=unclassified&saved=')

  const rows = await db
    .select({ id: transactions.id, categoryId: transactions.categoryId, fixed: transactions.fixed })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, context.householdId),
        inArray(transactions.id, transactionIds.slice(0, 2)),
      ),
    )
  expect(rows.find((row) => row.id === transactionIds[0])).toMatchObject({ categoryId: expenseCategoryId, fixed: true })
  expect(rows.find((row) => row.id === transactionIds[1])).toMatchObject({ categoryId: incomeCategoryId, fixed: false })

  const rules = await db
    .select({ flow: categoryRules.flow })
    .from(categoryRules)
    .where(eq(categoryRules.householdId, context.householdId))
  expect(rules).toHaveLength(2)
  expect(new Set(rules.map((rule) => rule.flow))).toEqual(new Set(['expense', 'income']))
})
