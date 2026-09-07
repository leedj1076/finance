import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import {
  categories,
  households,
  importBatches,
  importInbox,
  merchantLookup,
  transactions,
} from '@/db/schema'
import { processInbox } from '@/features/inbox/actions'

const context = vi.hoisted(() => ({ householdId: '' }))
const failure = vi.hoisted(() => ({ enabled: false }))

vi.mock('@/lib/household', () => ({
  requireHousehold: async () => ({
    userId: 'inbox-atomic-test-user',
    householdId: context.householdId,
  }),
}))

vi.mock('@/features/inbox/merchant-lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/inbox/merchant-lookup')>()
  return {
    ...actual,
    merchantLookupUpsertStatement: (
      ...args: Parameters<typeof actual.merchantLookupUpsertStatement>
    ) => {
      if (failure.enabled) throw new Error('forced merchant lookup failure')
      return actual.merchantLookupUpsertStatement(...args)
    },
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) },
}))

const householdIds: string[] = []
let categoryId: number

beforeAll(async () => {
  const [household] = await db
    .insert(households)
    .values({ name: 'TEST-inbox-atomic' })
    .returning({ id: households.id })
  householdIds.push(household.id)
  context.householdId = household.id
  const [category] = await db
    .insert(categories)
    .values({ householdId: household.id, kind: 'expense', major: '식비', sub: '외식' })
    .returning({ id: categories.id })
  categoryId = category.id
})

afterAll(async () => {
  failure.enabled = false
  if (householdIds.length > 0) {
    await db.delete(households).where(inArray(households.id, householdIds))
  }
})

test('merchant learning failure rolls back transaction, batch, and inbox status together', async () => {
  const [row] = await db
    .insert(importInbox)
    .values({
      householdId: context.householdId,
      importUid: `atomic-${crypto.randomUUID()}`,
      owner: 'DJ',
      date: '2026-09-02',
      merchant: '원자적학습가게',
      amount: 17_000,
      flow: 'expense',
    })
    .returning({ id: importInbox.id })

  const formData = new FormData()
  formData.set('ids', String(row.id))
  formData.set(`flow_${row.id}`, 'expense')
  formData.set(`category_${row.id}`, String(categoryId))

  failure.enabled = true
  await expect(processInbox(formData)).rejects.toThrow('forced merchant lookup failure')
  failure.enabled = false

  const [inboxRow] = await db
    .select({ status: importInbox.status })
    .from(importInbox)
    .where(eq(importInbox.id, row.id))
  expect(inboxRow.status).toBe('pending')

  const transactionRows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.householdId, context.householdId))
  const batchRows = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(eq(importBatches.householdId, context.householdId))
  const lookupRows = await db
    .select({ id: merchantLookup.id })
    .from(merchantLookup)
    .where(eq(merchantLookup.householdId, context.householdId))
  expect(transactionRows).toHaveLength(0)
  expect(batchRows).toHaveLength(0)
  expect(lookupRows).toHaveLength(0)
})
