import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { categories, households, merchantLookup } from '@/db/schema'
import {
  deleteMerchantLookup,
  toggleAlwaysConfirm,
  updateMerchantLookupCategory,
} from '@/features/manage/actions'
import { getManageData } from '@/features/manage/queries'

const context = vi.hoisted(() => ({ householdId: '' }))

vi.mock('@/lib/household', () => ({
  requireHousehold: async () => ({
    userId: 'merchant-dictionary-test-user',
    householdId: context.householdId,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) },
}))

const householdIds: string[] = []
let ownExpenseCategoryId: number
let ownIncomeCategoryId: number
let ownHiddenCategoryId: number
let foreignExpenseCategoryId: number
let managedEntryId: number
let validationEntryId: number

beforeAll(async () => {
  const created = await db
    .insert(households)
    .values([{ name: 'TEST-dictionary-own' }, { name: 'TEST-dictionary-foreign' }])
    .returning({ id: households.id })
  householdIds.push(...created.map((row) => row.id))
  context.householdId = householdIds[0]

  const categoryRows = await db
    .insert(categories)
    .values([
      { householdId: householdIds[0], kind: 'expense', major: '식비', sub: '카페' },
      { householdId: householdIds[0], kind: 'income', major: '월급', sub: '급여' },
      { householdId: householdIds[0], kind: 'expense', major: '숨김', sub: '이전', hidden: true },
      { householdId: householdIds[1], kind: 'expense', major: '타가구', sub: '비밀' },
    ])
    .returning({
      id: categories.id,
      householdId: categories.householdId,
      kind: categories.kind,
      hidden: categories.hidden,
    })
  ownExpenseCategoryId = categoryRows.find(
    (row) => row.householdId === householdIds[0] && row.kind === 'expense' && !row.hidden,
  )!.id
  ownIncomeCategoryId = categoryRows.find(
    (row) => row.householdId === householdIds[0] && row.kind === 'income',
  )!.id
  ownHiddenCategoryId = categoryRows.find((row) => row.hidden)!.id
  foreignExpenseCategoryId = categoryRows.find((row) => row.householdId === householdIds[1])!.id

  const ownEntries = await db
    .insert(merchantLookup)
    .values([
      {
        householdId: householdIds[0],
        normMerchant: '관리대상',
        displayMerchant: '관리 대상 가맹점',
        categoryId: ownExpenseCategoryId,
        flow: 'expense',
        source: 'ai',
        confidence: 'low',
      },
      {
        householdId: householdIds[0],
        normMerchant: '검증대상',
        displayMerchant: '검증 대상 가맹점',
        categoryId: ownExpenseCategoryId,
        flow: 'expense',
        source: 'user',
        confidence: 'high',
      },
    ])
    .returning({ id: merchantLookup.id })
  ;[managedEntryId, validationEntryId] = ownEntries.map((row) => row.id)

  await db.insert(merchantLookup).values({
    householdId: householdIds[1],
    normMerchant: '타가구사전',
    displayMerchant: '타가구 사전',
    categoryId: foreignExpenseCategoryId,
    flow: 'expense',
    source: 'user',
    confidence: 'high',
  })
})

afterAll(async () => {
  if (householdIds.length > 0) {
    await db.delete(households).where(inArray(households.id, householdIds))
  }
})

function updateForm(id: number, categoryId: number, flow: 'expense' | 'income' | 'saving') {
  const formData = new FormData()
  formData.set('id', String(id))
  formData.set('categoryId', String(categoryId))
  formData.set('flow', flow)
  return formData
}

function idForm(id: number) {
  const formData = new FormData()
  formData.set('id', String(id))
  return formData
}

test('dictionary query is household scoped and includes source metadata', async () => {
  const data = await getManageData(householdIds[0], { tab: 'rules' })
  expect(data.dictionary).toHaveLength(2)
  expect(data.counts.rules).toBe(2)
  expect(data.dictionary.map((entry) => entry.normMerchant)).not.toContain('타가구사전')
  expect(data.dictionary[0]).toHaveProperty('source')
  expect(data.dictionary[0]).toHaveProperty('hitCount')
})

test('foreign household cannot update, toggle, or delete an entry', async () => {
  context.householdId = householdIds[1]
  await expect(
    updateMerchantLookupCategory(updateForm(managedEntryId, foreignExpenseCategoryId, 'expense')),
  ).rejects.toThrow('REDIRECT:/manage?tab=rules&error=')
  await expect(toggleAlwaysConfirm(idForm(managedEntryId))).rejects.toThrow(
    'REDIRECT:/manage?tab=rules&error=',
  )
  await expect(deleteMerchantLookup(idForm(managedEntryId))).rejects.toThrow(
    'REDIRECT:/manage?tab=rules&error=',
  )

  const [entry] = await db
    .select({ source: merchantLookup.source, alwaysConfirm: merchantLookup.alwaysConfirm })
    .from(merchantLookup)
    .where(
      and(
        eq(merchantLookup.householdId, householdIds[0]),
        eq(merchantLookup.id, managedEntryId),
      ),
    )
  expect(entry).toEqual({ source: 'ai', alwaysConfirm: false })
})

test('category update becomes user-confirmed, toggle is atomic, and delete removes own entry', async () => {
  context.householdId = householdIds[0]
  await expect(
    updateMerchantLookupCategory(updateForm(managedEntryId, ownIncomeCategoryId, 'income')),
  ).rejects.toThrow('REDIRECT:/manage?tab=rules&saved=')

  let [entry] = await db
    .select({
      categoryId: merchantLookup.categoryId,
      flow: merchantLookup.flow,
      source: merchantLookup.source,
      confidence: merchantLookup.confidence,
      alwaysConfirm: merchantLookup.alwaysConfirm,
    })
    .from(merchantLookup)
    .where(eq(merchantLookup.id, managedEntryId))
  expect(entry).toMatchObject({
    categoryId: ownIncomeCategoryId,
    flow: 'income',
    source: 'user',
    confidence: 'high',
    alwaysConfirm: false,
  })

  await expect(toggleAlwaysConfirm(idForm(managedEntryId))).rejects.toThrow(
    'REDIRECT:/manage?tab=rules&saved=',
  )
  ;[entry] = await db
    .select({
      categoryId: merchantLookup.categoryId,
      flow: merchantLookup.flow,
      source: merchantLookup.source,
      confidence: merchantLookup.confidence,
      alwaysConfirm: merchantLookup.alwaysConfirm,
    })
    .from(merchantLookup)
    .where(eq(merchantLookup.id, managedEntryId))
  expect(entry.alwaysConfirm).toBe(true)

  await expect(deleteMerchantLookup(idForm(managedEntryId))).rejects.toThrow(
    'REDIRECT:/manage?tab=rules&saved=',
  )
  const deleted = await db
    .select({ id: merchantLookup.id })
    .from(merchantLookup)
    .where(eq(merchantLookup.id, managedEntryId))
  expect(deleted).toHaveLength(0)
})

test('hidden, foreign, and flow-mismatched categories are rejected', async () => {
  context.householdId = householdIds[0]
  await expect(
    updateMerchantLookupCategory(updateForm(validationEntryId, ownHiddenCategoryId, 'expense')),
  ).rejects.toThrow('REDIRECT:/manage?tab=rules&error=')
  await expect(
    updateMerchantLookupCategory(updateForm(validationEntryId, foreignExpenseCategoryId, 'expense')),
  ).rejects.toThrow('REDIRECT:/manage?tab=rules&error=')
  await expect(
    updateMerchantLookupCategory(updateForm(validationEntryId, ownExpenseCategoryId, 'income')),
  ).rejects.toThrow('REDIRECT:/manage?tab=rules&error=')

  const [entry] = await db
    .select({ categoryId: merchantLookup.categoryId, flow: merchantLookup.flow })
    .from(merchantLookup)
    .where(eq(merchantLookup.id, validationEntryId))
  expect(entry).toEqual({ categoryId: ownExpenseCategoryId, flow: 'expense' })
})
