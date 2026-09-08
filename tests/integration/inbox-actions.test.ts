import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import {
  accountAliases,
  accounts,
  categories,
  categoryRules,
  households,
  importBatches,
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

test('applyInboxItem saves an edited title while preserving source identity and learning', async () => {
  const merchant = `바로반영-${crypto.randomUUID()}`
  const title = `편집한 거래명-${crypto.randomUUID()}`
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
    title: `  ${title}  `,
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
      memo: transactions.memo,
      rawMerchant: transactions.rawMerchant,
      importUid: transactions.importUid,
    })
    .from(transactions)
    .where(eq(transactions.importUid, importUid))
  expect(transaction).toEqual({
    flow: 'expense',
    categoryId,
    accountId,
    memo: title,
    rawMerchant: merchant,
    importUid,
  })

  const [lookup] = await db
    .select({ displayMerchant: merchantLookup.displayMerchant })
    .from(merchantLookup)
    .where(and(
      eq(merchantLookup.householdId, context.householdId),
      eq(merchantLookup.normMerchant, normalizeMerchant(merchant)),
    ))
  expect(lookup).toEqual({ displayMerchant: merchant })
})

test('omitted titles keep legacy merchant and memo fallbacks, including long source titles', async () => {
  const longMerchant = `긴원문-${'가'.repeat(210)}`
  const memoFallback = `메모대체-${crypto.randomUUID()}`
  const rows = await db.insert(importInbox).values([
    {
      householdId: context.householdId, importUid: crypto.randomUUID(), owner: 'DJ',
      date: '2026-09-04', merchant: longMerchant, memo: '사용하지 않는 메모', amount: 4100,
      flow: 'expense' as const,
    },
    {
      householdId: context.householdId, importUid: crypto.randomUUID(), owner: 'DJ',
      date: '2026-09-04', merchant: null, memo: memoFallback, amount: 4200,
      flow: 'expense' as const,
    },
  ]).returning({ id: importInbox.id, importUid: importInbox.importUid })

  for (const row of rows) {
    await expect(applyInboxItem({
      id: row.id, flow: 'expense', categoryId, accountId,
    })).resolves.toMatchObject({ applied: true })
  }

  const saved = await db.select({ importUid: transactions.importUid, memo: transactions.memo })
    .from(transactions)
    .where(inArray(transactions.importUid, rows.map((row) => row.importUid)))
  expect(new Map(saved.map((row) => [row.importUid, row.memo]))).toEqual(new Map([
    [rows[0].importUid, longMerchant],
    [rows[1].importUid, memoFallback],
  ]))
})

test.each([
  ['blank', '   '],
  ['over 200 characters', '나'.repeat(201)],
  ['non-string', 123],
])('applyInboxItem rejects an explicitly edited %s title before any write', async (_case, title) => {
  const importUid = `invalid-title-${crypto.randomUUID()}`
  const [row] = await db.insert(importInbox).values({
    householdId: context.householdId, importUid, owner: 'DJ', date: '2026-09-05',
    merchant: '검증 원문', amount: 4300, flow: 'expense',
  }).returning({ id: importInbox.id })
  const beforeTransactions = await db.select({ id: transactions.id }).from(transactions)
    .where(eq(transactions.householdId, context.householdId))
  const beforeBatches = await db.select({ id: importBatches.id }).from(importBatches)
    .where(eq(importBatches.householdId, context.householdId))

  await expect(applyInboxItem({
    id: row.id,
    flow: 'expense',
    categoryId,
    accountId,
    title: title as string,
  })).resolves.toHaveProperty('error')

  const afterTransactions = await db.select({ id: transactions.id }).from(transactions)
    .where(eq(transactions.householdId, context.householdId))
  const afterBatches = await db.select({ id: importBatches.id }).from(importBatches)
    .where(eq(importBatches.householdId, context.householdId))
  const [source] = await db.select({ status: importInbox.status, merchant: importInbox.merchant })
    .from(importInbox).where(eq(importInbox.id, row.id))
  expect(afterTransactions).toHaveLength(beforeTransactions.length)
  expect(afterBatches).toHaveLength(beforeBatches.length)
  expect(source).toEqual({ status: 'pending', merchant: '검증 원문' })
})

test('bulk apply saves selected edited titles only and remains retry-idempotent', async () => {
  const merchants = ['일괄 원문 하나', '일괄 원문 둘', '선택 안 한 원문']
    .map((prefix) => `${prefix}-${crypto.randomUUID()}`)
  const rows = await db.insert(importInbox).values(merchants.map((merchant) => ({
    householdId: context.householdId, importUid: crypto.randomUUID(), owner: 'DJ',
    date: '2026-09-06', merchant, amount: 4400, flow: 'expense' as const,
  }))).returning({ id: importInbox.id, importUid: importInbox.importUid })
  const titles = [`일괄 편집 하나-${crypto.randomUUID()}`, `일괄 편집 둘-${crypto.randomUUID()}`]
  const form = new FormData()
  form.set('inline', '1')
  form.set('intent', 'apply')
  for (const [index, row] of rows.entries()) {
    form.set(`flow_${row.id}`, 'expense')
    form.set(`category_${row.id}`, String(categoryId))
    form.set(`account_${row.id}`, String(accountId))
    form.set(`title_${row.id}`, index < 2 ? ` ${titles[index]} ` : '선택 안 한 편집값')
    if (index < 2) form.append('ids', String(row.id))
  }

  const firstResult = await processInbox(form)
  expect(firstResult).not.toHaveProperty('error')
  if ('processedIds' in firstResult) {
    expect(new Set(firstResult.processedIds)).toEqual(new Set([rows[0].id, rows[1].id]))
  }
  await expect(processInbox(form)).resolves.toHaveProperty('error')

  const saved = await db.select({
    importUid: transactions.importUid,
    memo: transactions.memo,
    rawMerchant: transactions.rawMerchant,
  }).from(transactions).where(inArray(transactions.importUid, rows.map((row) => row.importUid)))
    .orderBy(transactions.id)
  expect(saved).toHaveLength(2)
  expect(saved.map((row) => [row.memo, row.rawMerchant])).toEqual([
    [titles[0], merchants[0]],
    [titles[1], merchants[1]],
  ])
  const [unselected] = await db.select({ status: importInbox.status, merchant: importInbox.merchant })
    .from(importInbox).where(eq(importInbox.id, rows[2].id))
  expect(unselected).toEqual({ status: 'pending', merchant: merchants[2] })
})

test.each([
  ['blank', '   '],
  ['over 200 characters', '나'.repeat(201)],
  ['non-string', new Blob(['거래명 파일'])],
])('one %s bulk title rejects the whole selected batch before writes', async (_case, invalidTitle) => {
  const rows = await db.insert(importInbox).values([4500, 4600].map((amount) => ({
    householdId: context.householdId, importUid: crypto.randomUUID(), owner: 'DJ',
    date: '2026-09-07', merchant: `원자성-${crypto.randomUUID()}`, amount,
    flow: 'expense' as const,
  }))).returning({ id: importInbox.id, importUid: importInbox.importUid })
  const form = new FormData()
  form.set('inline', '1')
  for (const row of rows) {
    form.append('ids', String(row.id))
    form.set(`flow_${row.id}`, 'expense')
    form.set(`category_${row.id}`, String(categoryId))
  }
  form.set(`title_${rows[0].id}`, '정상 제목')
  form.set(`title_${rows[1].id}`, invalidTitle)
  const beforeBatches = await db.select({ id: importBatches.id }).from(importBatches)
    .where(eq(importBatches.householdId, context.householdId))

  await expect(processInbox(form)).resolves.toHaveProperty('error')

  const saved = await db.select({ id: transactions.id }).from(transactions)
    .where(inArray(transactions.importUid, rows.map((row) => row.importUid)))
  const statuses = await db.select({ status: importInbox.status }).from(importInbox)
    .where(inArray(importInbox.id, rows.map((row) => row.id)))
  const afterBatches = await db.select({ id: importBatches.id }).from(importBatches)
    .where(eq(importBatches.householdId, context.householdId))
  expect(saved).toHaveLength(0)
  expect(statuses).toEqual([{ status: 'pending' }, { status: 'pending' }])
  expect(afterBatches).toHaveLength(beforeBatches.length)
})

test('edited titles cannot apply foreign or already processed rows', async () => {
  const [other] = await db.insert(households).values({ name: 'TEST-title-other' }).returning()
  householdIds.push(other.id)
  const [done, foreign] = await db.insert(importInbox).values([
    { householdId: context.householdId, status: 'done' as const },
    { householdId: other.id, status: 'pending' as const },
  ].map((scope) => ({
    ...scope, importUid: crypto.randomUUID(), owner: 'DJ', date: '2026-09-08',
    merchant: '보호할 원문', amount: 4700, flow: 'expense' as const,
  }))).returning({ id: importInbox.id, importUid: importInbox.importUid })

  for (const row of [done, foreign]) {
    await expect(applyInboxItem({
      id: row.id, flow: 'expense', categoryId, accountId, title: '허용하면 안 되는 제목',
    })).resolves.toHaveProperty('error')
  }
  const saved = await db.select({ id: transactions.id }).from(transactions)
    .where(inArray(transactions.importUid, [done.importUid, foreign.importUid]))
  expect(saved).toHaveLength(0)
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
  for (const row of [pending, done, foreign]) {
    form.append('ids', String(row.id))
    form.set(`title_${row.id}`, '제외하면서 저장하면 안 되는 제목')
  }
  await expect(processInbox(form)).resolves.toEqual({
    processedIds: [pending.id], message: '1건을 인박스에서 제외했습니다.',
  })
  const rows = await db.select({ id: importInbox.id, status: importInbox.status, merchant: importInbox.merchant }).from(importInbox)
    .where(inArray(importInbox.id, [pending.id, done.id, foreign.id])).orderBy(importInbox.id)
  expect(rows).toEqual([
    { id: pending.id, status: 'dismissed', merchant: '일괄 제외' },
    { id: done.id, status: 'done', merchant: '일괄 제외' },
    { id: foreign.id, status: 'pending', merchant: '일괄 제외' },
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
