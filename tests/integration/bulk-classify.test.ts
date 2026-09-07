import { and, eq, inArray, isNull } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { categories, households, merchantLookup, transactions } from '@/db/schema'
import { normalizeMerchant } from '@/features/inbox/normalize'
import { bulkClassifyTransactions } from '@/features/manage/actions'
import {
  classificationFromToken,
  classificationToken,
} from '@/features/manage/bulk-classification'
import { getManageData } from '@/features/manage/queries'

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
const raw = postgres(process.env.DATABASE_URL!, { prepare: false })
let foreignTransactionId: number
let foreignExpenseCategoryId: number
let expenseCategoryId: number
let alternateExpenseCategoryId: number
let incomeCategoryId: number
let hiddenCategoryId: number
let historySuggestionTransactionId: number
let ruleSuggestionTransactionId: number
let flowChangeTransactionId: number
let hiddenValidationTransactionId: number
let delayTransactionId: number
let raceTransactionId: number
let isolationTransactionId: number
let aiSuggestionTransactionId: number

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
      { householdId: context.householdId, kind: 'expense', major: '생활용품', sub: '잡화' },
      { householdId: context.householdId, kind: 'income', major: '월급', sub: '급여' },
      { householdId: context.householdId, kind: 'expense', major: '숨김', sub: '이전분류', hidden: true },
      { householdId: householdIds[1], kind: 'expense', major: '타가구', sub: '비밀' },
    ])
    .returning({
      id: categories.id,
      householdId: categories.householdId,
      kind: categories.kind,
      major: categories.major,
    })
  expenseCategoryId = categoryRows.find((row) => row.major === '식비')!.id
  alternateExpenseCategoryId = categoryRows.find((row) => row.major === '생활용품')!.id
  incomeCategoryId = categoryRows.find((row) => row.householdId === context.householdId && row.kind === 'income')!.id
  foreignExpenseCategoryId = categoryRows.find((row) => row.householdId === householdIds[1])!.id
  const hiddenRows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.householdId, context.householdId),
        eq(categories.hidden, true),
      ),
    )
  hiddenCategoryId = hiddenRows[0].id

  const currentRows = await db
    .insert(transactions)
    .values([
      { householdId: context.householdId, date: '2026-08-01', flow: 'expense', memo: '동네식당', rawMerchant: '동네식당', amount: 12000 },
      { householdId: context.householdId, date: '2026-08-02', flow: 'income', memo: '회사급여', rawMerchant: '회사급여', amount: 3000000 },
      { householdId: context.householdId, date: '2026-08-03', flow: 'expense', memo: '분류오류검증', amount: 9000 },
    ])
    .returning({ id: transactions.id })
  transactionIds.push(...currentRows.map((row) => row.id))
  await db.insert(transactions).values([
    {
      householdId: context.householdId,
      date: '2026-07-01',
      flow: 'expense',
      fixed: true,
      categoryId: expenseCategoryId,
      memo: '추천상점',
      rawMerchant: '추천상점',
      amount: 20_000,
    },
    {
      householdId: context.householdId,
      date: '2026-07-02',
      flow: 'expense',
      fixed: true,
      categoryId: expenseCategoryId,
      memo: '규칙우선상점',
      rawMerchant: '규칙우선상점',
      amount: 30_000,
    },
  ])
  const recommendationRows = await db
    .insert(transactions)
    .values([
      { householdId: context.householdId, date: '2026-08-04', flow: 'income', fixed: false, memo: '추천상점', rawMerchant: '추천상점', amount: 10_000 },
      { householdId: context.householdId, date: '2026-08-05', flow: 'expense', fixed: true, memo: '규칙우선상점', rawMerchant: '규칙우선상점', amount: 11_000 },
      { householdId: context.householdId, date: '2026-08-06', flow: 'expense', fixed: false, memo: '유형전환검증', rawMerchant: '유형전환검증', amount: 12_000 },
      { householdId: context.householdId, date: '2026-08-07', flow: 'expense', fixed: false, memo: '숨김검증', rawMerchant: '숨김검증', amount: 13_000 },
      { householdId: context.householdId, date: '2026-08-08', flow: 'expense', fixed: false, memo: 'bulk-delay-row', rawMerchant: 'bulk-delay-row', amount: 14_000 },
      { householdId: context.householdId, date: '2026-08-09', flow: 'expense', fixed: false, memo: '동시분류대상', rawMerchant: '동시분류대상', amount: 15_000 },
      { householdId: context.householdId, date: '2026-08-10', flow: 'expense', fixed: false, memo: '격리상점', rawMerchant: '격리상점', amount: 16_000 },
      { householdId: context.householdId, date: '2026-08-11', flow: 'expense', fixed: false, memo: 'AI전용상점', rawMerchant: 'AI전용상점', amount: 17_000 },
    ])
    .returning({ id: transactions.id })
  ;[
    historySuggestionTransactionId,
    ruleSuggestionTransactionId,
    flowChangeTransactionId,
    hiddenValidationTransactionId,
    delayTransactionId,
    raceTransactionId,
    isolationTransactionId,
    aiSuggestionTransactionId,
  ] = recommendationRows.map((row) => row.id)

  await db.insert(merchantLookup).values({
    householdId: context.householdId,
    normMerchant: normalizeMerchant('규칙우선상점'),
    displayMerchant: '규칙우선상점',
    categoryId: alternateExpenseCategoryId,
    flow: 'expense',
    source: 'user',
    confidence: 'high',
    hitCount: 5,
  })
  await db.insert(merchantLookup).values([
    {
      householdId: context.householdId,
      normMerchant: normalizeMerchant('추천상점'),
      displayMerchant: '추천상점',
      categoryId: alternateExpenseCategoryId,
      flow: 'expense',
      source: 'ai',
      confidence: 'low',
      hitCount: 2,
    },
    {
      householdId: context.householdId,
      normMerchant: normalizeMerchant('AI전용상점'),
      displayMerchant: 'AI전용상점',
      categoryId: alternateExpenseCategoryId,
      flow: 'expense',
      source: 'ai',
      confidence: 'low',
      hitCount: 1,
    },
  ])
  await db.insert(merchantLookup).values({
    householdId: householdIds[1],
    normMerchant: normalizeMerchant('격리상점'),
    displayMerchant: '격리상점',
    categoryId: foreignExpenseCategoryId,
    flow: 'expense',
    source: 'user',
    confidence: 'high',
    hitCount: 10,
  })
  await db.insert(transactions).values({
    householdId: householdIds[1],
    date: '2026-07-03',
    flow: 'expense',
    fixed: true,
    categoryId: foreignExpenseCategoryId,
    memo: '격리상점',
    rawMerchant: '격리상점',
    amount: 40_000,
  })
  const [foreignRow] = await db
    .insert(transactions)
    .values({ householdId: householdIds[1], date: '2026-08-01', flow: 'expense', memo: '타가구거래', amount: 777 })
    .returning({ id: transactions.id })
  foreignTransactionId = foreignRow.id
})

afterAll(async () => {
  if (householdIds.length > 0) await db.delete(households).where(inArray(households.id, householdIds))
  await raw.end()
})

test('maps Flask classification tokens including fixed and variable expense', () => {
  expect(classificationToken('expense', false)).toBe('exp_var')
  expect(classificationToken('expense', true)).toBe('exp_fix')
  expect(classificationFromToken('income')).toEqual({ flow: 'income', fixed: false })
  expect(classificationFromToken('saving')).toEqual({ flow: 'saving', fixed: false })
  expect(classificationFromToken('invalid')).toBeNull()
})

test('prefills user dictionary suggestions before history and preserves the row fixed flag', async () => {
  const data = await getManageData(context.householdId, { tab: 'unclassified' })
  const historySuggestion = data.unclassified.find(
    (row) => row.id === historySuggestionTransactionId,
  )
  const ruleSuggestion = data.unclassified.find(
    (row) => row.id === ruleSuggestionTransactionId,
  )
  const isolationSuggestion = data.unclassified.find(
    (row) => row.id === isolationTransactionId,
  )
  const aiSuggestion = data.unclassified.find(
    (row) => row.id === aiSuggestionTransactionId,
  )

  expect(historySuggestion).toMatchObject({
    suggestedFlow: 'expense',
    suggestedFixed: true,
    suggestedCategoryId: expenseCategoryId,
    suggestionSource: 'history',
  })
  expect(ruleSuggestion).toMatchObject({
    suggestedFlow: 'expense',
    suggestedFixed: true,
    suggestedCategoryId: alternateExpenseCategoryId,
    suggestionSource: 'user',
  })
  expect(isolationSuggestion).toMatchObject({
    suggestedCategoryId: null,
    suggestionSource: null,
  })
  expect(aiSuggestion).toMatchObject({
    suggestedFlow: 'expense',
    suggestedFixed: false,
    suggestedCategoryId: alternateExpenseCategoryId,
    suggestionSource: 'ai',
  })
})

test('rejects a category whose kind differs from the selected transaction flow', async () => {
  const formData = new FormData()
  formData.set('ids', String(transactionIds[2]))
  formData.set(`category_${transactionIds[2]}`, String(incomeCategoryId))
  formData.set(`flow_${transactionIds[2]}`, 'exp_var')
  await expect(bulkClassifyTransactions(formData)).rejects.toThrow('REDIRECT:/inbox?tab=unclassified&error=')

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
  formData.set(`flow_${foreignTransactionId}`, 'exp_var')
  await expect(bulkClassifyTransactions(formData)).rejects.toThrow('REDIRECT:/inbox?tab=unclassified&error=')

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

test('bulk classifies selected rows and learns user merchant dictionary entries', async () => {
  const formData = new FormData()
  formData.append('ids', String(transactionIds[0]))
  formData.append('ids', String(transactionIds[1]))
  formData.set(`category_${transactionIds[0]}`, String(expenseCategoryId))
  formData.set(`category_${transactionIds[1]}`, String(incomeCategoryId))
  formData.set(`flow_${transactionIds[0]}`, 'exp_fix')
  formData.set(`flow_${transactionIds[1]}`, 'income')
  await expect(bulkClassifyTransactions(formData)).rejects.toThrow('REDIRECT:/inbox?tab=unclassified&notice=')

  const rows = await db
    .select({ id: transactions.id, categoryId: transactions.categoryId, fixed: transactions.fixed, flow: transactions.flow })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, context.householdId),
        inArray(transactions.id, transactionIds.slice(0, 2)),
      ),
    )
  expect(rows.find((row) => row.id === transactionIds[0])).toMatchObject({ categoryId: expenseCategoryId, flow: 'expense', fixed: true })
  expect(rows.find((row) => row.id === transactionIds[1])).toMatchObject({ categoryId: incomeCategoryId, flow: 'income', fixed: false })

  const dictionary = await db
    .select({ normMerchant: merchantLookup.normMerchant, flow: merchantLookup.flow, source: merchantLookup.source })
    .from(merchantLookup)
    .where(eq(merchantLookup.householdId, context.householdId))
  expect(dictionary).toEqual(expect.arrayContaining([
    expect.objectContaining({ normMerchant: normalizeMerchant('동네식당'), flow: 'expense', source: 'user' }),
    expect.objectContaining({ normMerchant: normalizeMerchant('회사급여'), flow: 'income', source: 'user' }),
  ]))
})

test('updates flow, fixed, and category together', async () => {
  const formData = new FormData()
  formData.set('ids', String(flowChangeTransactionId))
  formData.set(`category_${flowChangeTransactionId}`, String(incomeCategoryId))
  formData.set(`flow_${flowChangeTransactionId}`, 'income')
  await expect(bulkClassifyTransactions(formData)).rejects.toThrow('REDIRECT:/inbox?tab=unclassified&notice=')

  const [row] = await db
    .select({ flow: transactions.flow, fixed: transactions.fixed, categoryId: transactions.categoryId })
    .from(transactions)
    .where(eq(transactions.id, flowChangeTransactionId))
  expect(row).toEqual({ flow: 'income', fixed: false, categoryId: incomeCategoryId })
})

test('rejects hidden categories even when the request is forged', async () => {
  const formData = new FormData()
  formData.set('ids', String(hiddenValidationTransactionId))
  formData.set(`category_${hiddenValidationTransactionId}`, String(hiddenCategoryId))
  formData.set(`flow_${hiddenValidationTransactionId}`, 'exp_var')
  await expect(bulkClassifyTransactions(formData)).rejects.toThrow('REDIRECT:/inbox?tab=unclassified&error=')

  const [row] = await db
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(eq(transactions.id, hiddenValidationTransactionId))
  expect(row.categoryId).toBeNull()
})

test('learns dictionary entries and counts success only for rows won by the conditional update', async () => {
  await raw.unsafe('drop trigger if exists test_bulk_classify_delay_trigger on transactions')
  await raw.unsafe('drop function if exists test_bulk_classify_delay()')
  await raw.unsafe(`
    create function test_bulk_classify_delay() returns trigger language plpgsql as $$
    begin
      if old.id = ${delayTransactionId} then perform pg_sleep(0.5); end if;
      return new;
    end
    $$
  `)
  await raw.unsafe(`
    create trigger test_bulk_classify_delay_trigger before update on transactions
    for each row execute function test_bulk_classify_delay()
  `)

  try {
    const formData = new FormData()
    for (const id of [delayTransactionId, raceTransactionId]) {
      formData.append('ids', String(id))
      formData.set(`category_${id}`, String(expenseCategoryId))
      formData.set(`flow_${id}`, 'exp_var')
    }
    const actionResult = bulkClassifyTransactions(formData).then(
      () => null,
      (error: unknown) => error,
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
    await raw`
      update transactions
      set category_id = ${alternateExpenseCategoryId}
      where id = ${raceTransactionId} and category_id is null
    `
    const redirectError = await actionResult

    expect(String(redirectError)).toContain(encodeURIComponent('1건을 분류'))
    const [raceRow] = await db
      .select({ categoryId: transactions.categoryId })
      .from(transactions)
      .where(eq(transactions.id, raceTransactionId))
    expect(raceRow.categoryId).toBe(alternateExpenseCategoryId)

    const raceEntries = await db
      .select({ id: merchantLookup.id })
      .from(merchantLookup)
      .where(
        and(
          eq(merchantLookup.householdId, context.householdId),
          eq(merchantLookup.normMerchant, normalizeMerchant('동시분류대상')),
        ),
      )
    expect(raceEntries).toHaveLength(0)
  } finally {
    await raw.unsafe('drop trigger if exists test_bulk_classify_delay_trigger on transactions')
    await raw.unsafe('drop function if exists test_bulk_classify_delay()')
  }
})
