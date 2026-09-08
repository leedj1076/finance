import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import {
  accountAliases,
  accounts,
  categories,
  categoryRules,
  households,
  importInbox,
  merchantLookup,
  transactions,
} from '@/db/schema'
import { applyInboxItem, processInbox } from '@/features/inbox/actions'
import { normalizeMerchant } from '@/features/inbox/normalize'

const context = vi.hoisted(() => ({ householdId: '' }))

vi.mock('@/lib/household', () => ({
  requireHousehold: async () => ({
    userId: 'inbox-actions-test-user',
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
  const [household] = await db
    .insert(households)
    .values({ name: 'TEST-inbox-actions' })
    .returning({ id: households.id })
  householdIds.push(household.id)
  context.householdId = household.id

  const [category] = await db
    .insert(categories)
    .values({ householdId: household.id, kind: 'expense', major: '식비', sub: '카페' })
    .returning({ id: categories.id })
  categoryId = category.id

  const [account] = await db
    .insert(accounts)
    .values({ householdId: household.id, name: '확정 카드', owner: 'DJ' })
    .returning({ id: accounts.id })
  accountId = account.id
})

afterAll(async () => {
  if (householdIds.length > 0) {
    await db.delete(households).where(inArray(households.id, householdIds))
  }
})

test('processInbox learns user merchant lookup, freezes category rules, and keeps alias learning', async () => {
  const merchant = `학습가게-${crypto.randomUUID()}`
  const importUid = `inbox-learn-${crypto.randomUUID()}`
  const [row] = await db
    .insert(importInbox)
    .values({
      householdId: context.householdId,
      importUid,
      owner: 'DJ',
      date: '2026-09-02',
      merchant,
      amount: 8_500,
      flow: 'expense',
      pay: '새 카드 별칭',
    })
    .returning({ id: importInbox.id })

  const formData = new FormData()
  formData.set('intent', 'apply')
  formData.set('ids', String(row.id))
  formData.set(`flow_${row.id}`, 'expense')
  formData.set(`category_${row.id}`, String(categoryId))
  formData.set(`account_${row.id}`, String(accountId))

  await expect(processInbox(formData)).rejects.toThrow('REDIRECT:/inbox?notice=')

  const [lookup] = await db
    .select({
      source: merchantLookup.source,
      categoryId: merchantLookup.categoryId,
      flow: merchantLookup.flow,
      displayMerchant: merchantLookup.displayMerchant,
    })
    .from(merchantLookup)
    .where(
      and(
        eq(merchantLookup.householdId, context.householdId),
        eq(merchantLookup.normMerchant, normalizeMerchant(merchant)),
      ),
    )
  expect(lookup).toEqual({
    source: 'user',
    categoryId,
    flow: 'expense',
    displayMerchant: merchant,
  })

  const rules = await db
    .select({ id: categoryRules.id })
    .from(categoryRules)
    .where(eq(categoryRules.householdId, context.householdId))
  expect(rules).toHaveLength(0)

  const [alias] = await db
    .select({ alias: accountAliases.alias, accountId: accountAliases.accountId })
    .from(accountAliases)
    .where(eq(accountAliases.householdId, context.householdId))
  expect(alias).toEqual({ alias: '새 카드 별칭', accountId })

  const [transaction] = await db
    .select({ importUid: transactions.importUid })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, context.householdId),
        eq(transactions.importUid, importUid),
      ),
    )
  expect(transaction.importUid).toBe(importUid)
})

test('applyInboxItem applies one edited row without redirecting', async () => {
  const merchant = `바로반영-${crypto.randomUUID()}`
  const importUid = `inbox-single-${crypto.randomUUID()}`
  const [row] = await db
    .insert(importInbox)
    .values({
      householdId: context.householdId,
      importUid,
      owner: 'DJ',
      date: '2026-09-03',
      merchant,
      amount: 12_300,
      flow: 'income',
      confidence: 'high',
      pay: '바로 반영 카드',
    })
    .returning({ id: importInbox.id })

  await expect(applyInboxItem({
    id: row.id,
    flow: 'expense',
    categoryId,
    accountId,
  })).resolves.toEqual({
    applied: true,
    message: '가계부에 반영했습니다.',
  })

  const [inboxRow] = await db
    .select({ status: importInbox.status })
    .from(importInbox)
    .where(eq(importInbox.id, row.id))
  expect(inboxRow.status).toBe('done')

  const [transaction] = await db
    .select({
      flow: transactions.flow,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
      importUid: transactions.importUid,
    })
    .from(transactions)
    .where(eq(transactions.importUid, importUid))
  expect(transaction).toEqual({
    flow: 'expense',
    categoryId,
    accountId,
    importUid,
  })
})

test('inline bulk dismissal returns only changed household-owned pending ids', async () => {
  const [other] = await db.insert(households).values({ name: 'TEST-inline-other' }).returning()
  householdIds.push(other.id)
  const [pending, done, foreign] = await db.insert(importInbox).values([
    { householdId: context.householdId, status: 'pending' as const },
    { householdId: context.householdId, status: 'done' as const },
    { householdId: other.id, status: 'pending' as const },
  ].map((scope) => ({
    ...scope, importUid: crypto.randomUUID(), owner: 'DJ',
    date: '2026-09-02', merchant: '일괄 제외', amount: 5000, flow: 'expense' as const,
  }))).returning({ id: importInbox.id })
  const form = new FormData()
  form.set('inline', '1')
  form.set('intent', 'dismiss')
  for (const row of [pending, done, foreign]) form.append('ids', String(row.id))
  await expect(processInbox(form)).resolves.toEqual({
    processedIds: [pending.id], message: '1건을 인박스에서 제외했습니다.',
  })
  const rows = await db.select({ id: importInbox.id, status: importInbox.status }).from(importInbox)
    .where(inArray(importInbox.id, [pending.id, done.id, foreign.id])).orderBy(importInbox.id)
  expect(rows).toEqual([
    { id: pending.id, status: 'dismissed' },
    { id: done.id, status: 'done' },
    { id: foreign.id, status: 'pending' },
  ])
})

test('inline bulk apply returns its edited rows without redirecting and leaves invalid rows pending', async () => {
  const [row] = await db.insert(importInbox).values({
    householdId: context.householdId, importUid: crypto.randomUUID(), owner: 'DJ',
    date: '2026-09-02', merchant: `일괄 반영-${crypto.randomUUID()}`, amount: 3200, flow: 'expense',
  }).returning({ id: importInbox.id, importUid: importInbox.importUid })
  const form = new FormData()
  form.set('inline', '1')
  form.set('intent', 'apply')
  form.set('ids', String(row.id))
  form.set(`flow_${row.id}`, 'income')
  form.set(`category_${row.id}`, String(categoryId))
  await expect(processInbox(form)).resolves.toEqual({ error: `${row.id}번 거래의 분류가 거래 유형과 맞지 않습니다.` })
  const [pending] = await db.select({ status: importInbox.status }).from(importInbox).where(eq(importInbox.id, row.id))
  expect(pending.status).toBe('pending')

  form.set(`flow_${row.id}`, 'expense')
  await expect(processInbox(form)).resolves.toEqual({
    processedIds: [row.id], message: '1건을 가계부에 반영했습니다 (지출 3,200원).',
  })
  const [saved] = await db.select({ categoryId: transactions.categoryId, amount: transactions.amount })
    .from(transactions).where(and(eq(transactions.householdId, context.householdId), eq(transactions.importUid, row.importUid)))
  expect(saved).toEqual({ categoryId, amount: 3200 })
})

test('a conflicting import uid is not inserted or learned a second time', async () => {
  const merchant = `중복학습-${crypto.randomUUID()}`
  const importUid = `inbox-existing-${crypto.randomUUID()}`
  await db.insert(transactions).values({
    householdId: context.householdId,
    date: '2026-09-01',
    flow: 'expense',
    categoryId,
    amount: 5_000,
    source: 'manual',
    importUid,
  })
  const [row] = await db
    .insert(importInbox)
    .values({
      householdId: context.householdId,
      importUid,
      owner: 'DJ',
      date: '2026-09-02',
      merchant,
      amount: 5_000,
      flow: 'expense',
    })
    .returning({ id: importInbox.id })

  const formData = new FormData()
  formData.set('ids', String(row.id))
  formData.set(`flow_${row.id}`, 'expense')
  formData.set(`category_${row.id}`, String(categoryId))
  await expect(processInbox(formData)).rejects.toThrow('REDIRECT:/inbox?notice=')

  const duplicates = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, context.householdId),
        eq(transactions.importUid, importUid),
      ),
    )
  expect(duplicates).toHaveLength(1)

  const lookup = await db
    .select({ id: merchantLookup.id })
    .from(merchantLookup)
    .where(
      and(
        eq(merchantLookup.householdId, context.householdId),
        eq(merchantLookup.normMerchant, normalizeMerchant(merchant)),
      ),
    )
  expect(lookup).toHaveLength(0)
})
