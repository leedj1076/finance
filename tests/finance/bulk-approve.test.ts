import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import {
  accounts,
  categories,
  households,
  importInbox,
  merchantLookup,
  transactions,
} from '@/db/schema'
import { approveHighConfidence, demoteToReview } from '@/features/inbox/actions'

const context = vi.hoisted(() => ({ householdId: '' }))

vi.mock('@/lib/household', () => ({
  requireHousehold: async () => ({
    userId: 'bulk-approve-test-user',
    householdId: context.householdId,
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) },
}))

const householdIds: string[] = []
let categoryId: number
let accountId: number

beforeAll(async () => {
  const created = await db
    .insert(households)
    .values([{ name: 'TEST-bulk-approve-current' }, { name: 'TEST-bulk-approve-other' }])
    .returning({ id: households.id })
  householdIds.push(...created.map((row) => row.id))
  context.householdId = householdIds[0]

  const [category] = await db
    .insert(categories)
    .values({ householdId: context.householdId, kind: 'expense', major: '식비', sub: '외식' })
    .returning({ id: categories.id })
  categoryId = category.id
  const [account] = await db
    .insert(accounts)
    .values({ householdId: context.householdId, name: '공용카드', owner: 'DJ' })
    .returning({ id: accounts.id })
  accountId = account.id
})

afterAll(async () => {
  if (householdIds.length > 0) {
    await db.delete(households).where(inArray(households.id, householdIds))
  }
})

test('approveHighConfidence applies only high rows and is idempotent', async () => {
  const uidPrefix = crypto.randomUUID()
  await db.insert(importInbox).values([
    {
      householdId: context.householdId,
      importUid: `${uidPrefix}-high-a`,
      owner: 'DJ',
      date: '2026-09-01',
      merchant: '자동분류가게A',
      amount: 10_000,
      flow: 'expense',
      accountId,
      categoryId,
      confidence: 'high',
    },
    {
      householdId: context.householdId,
      importUid: `${uidPrefix}-high-b`,
      owner: 'DJ',
      date: '2026-09-02',
      merchant: '자동분류가게B',
      amount: 20_000,
      flow: 'expense',
      accountId,
      categoryId,
      confidence: 'high',
    },
    {
      householdId: context.householdId,
      importUid: `${uidPrefix}-review`,
      owner: 'DJ',
      date: '2026-09-03',
      merchant: '확인필요가게',
      amount: 30_000,
      flow: 'expense',
      accountId,
      categoryId,
      confidence: 'review',
    },
    {
      householdId: householdIds[1],
      importUid: `${uidPrefix}-other`,
      owner: 'YJ',
      date: '2026-09-04',
      merchant: '다른가구가게',
      amount: 40_000,
      flow: 'expense',
      confidence: 'high',
    },
  ])

  await expect(approveHighConfidence()).resolves.toEqual({ applied: 2 })

  const ownInbox = await db
    .select({ status: importInbox.status, confidence: importInbox.confidence })
    .from(importInbox)
    .where(eq(importInbox.householdId, context.householdId))
  expect(ownInbox.filter((row) => row.status === 'done')).toHaveLength(2)
  expect(ownInbox.filter((row) => row.status === 'pending')).toEqual([
    { status: 'pending', confidence: 'review' },
  ])

  const ownTransactions = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.householdId, context.householdId))
  expect(ownTransactions).toHaveLength(2)
  const learned = await db
    .select({ source: merchantLookup.source })
    .from(merchantLookup)
    .where(eq(merchantLookup.householdId, context.householdId))
  expect(learned).toEqual([{ source: 'user' }, { source: 'user' }])

  const [other] = await db
    .select({ status: importInbox.status })
    .from(importInbox)
    .where(eq(importInbox.householdId, householdIds[1]))
  expect(other.status).toBe('pending')

  await expect(approveHighConfidence()).resolves.toEqual({ applied: 0 })
  const afterRetry = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.householdId, context.householdId))
  expect(afterRetry).toHaveLength(2)
})

test('demoteToReview is scoped to household and pending status', async () => {
  const [ownPending] = await db
    .insert(importInbox)
    .values({
      householdId: context.householdId,
      importUid: `demote-own-${crypto.randomUUID()}`,
      owner: 'DJ',
      date: '2026-09-05',
      merchant: '수정할가게',
      amount: 1_000,
      flow: 'expense',
      categoryId,
      confidence: 'high',
    })
    .returning({ id: importInbox.id })
  const [ownDone] = await db
    .insert(importInbox)
    .values({
      householdId: context.householdId,
      importUid: `demote-done-${crypto.randomUUID()}`,
      owner: 'DJ',
      date: '2026-09-05',
      merchant: '이미반영된가게',
      amount: 2_000,
      flow: 'expense',
      categoryId,
      confidence: 'high',
      status: 'done',
    })
    .returning({ id: importInbox.id })
  const [otherPending] = await db
    .insert(importInbox)
    .values({
      householdId: householdIds[1],
      importUid: `demote-other-${crypto.randomUUID()}`,
      owner: 'YJ',
      date: '2026-09-05',
      merchant: '다른가구수정',
      amount: 3_000,
      flow: 'expense',
      confidence: 'high',
    })
    .returning({ id: importInbox.id })

  await expect(demoteToReview(otherPending.id)).resolves.toMatchObject({ error: expect.any(String) })
  await expect(demoteToReview(ownDone.id)).resolves.toMatchObject({ error: expect.any(String) })
  await expect(demoteToReview(ownPending.id)).resolves.toEqual({ demoted: true })

  const [own] = await db
    .select({ confidence: importInbox.confidence })
    .from(importInbox)
    .where(eq(importInbox.id, ownPending.id))
  const [other] = await db
    .select({ confidence: importInbox.confidence })
    .from(importInbox)
    .where(eq(importInbox.id, otherPending.id))
  expect(own.confidence).toBe('review')
  expect(other.confidence).toBe('high')
})
