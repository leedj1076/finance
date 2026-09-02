import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { classifyUnknownMerchants } from '@/features/inbox/ai-classify'
import { upsertMerchantLookup } from '@/features/inbox/merchant-lookup'
import { normalizeMerchant } from '@/features/inbox/normalize'
import { resolveSuggestions } from '@/features/inbox/resolve-suggestion'

vi.mock('@/features/inbox/ai-classify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/inbox/ai-classify')>()),
  aiFallbackEnabled: (setting: string | null) => setting !== '0',
  classifyUnknownMerchants: vi.fn(async ({ merchants }: { merchants: string[] }) =>
    merchants.map((merchant) => ({
      merchant,
      businessType: '카페',
      major: '식비',
      sub: '카페',
      flow: 'expense' as const,
      confidence: 'low' as const,
      note: 'mock',
    }))),
}))

let householdId: string
let cafeId: number

beforeAll(async () => {
  const [household] = await db.execute<{ id: string }>(sql`
    insert into households (name) values ('TEST-resolve') returning id
  `)
  householdId = household.id
  const [category] = await db.execute<{ id: number }>(sql`
    insert into categories (household_id, kind, major, sub)
    values (${householdId}, 'expense', '식비', '카페') returning id
  `)
  cafeId = Number(category.id)
})

afterAll(async () => {
  await db.execute(sql`delete from households where id = ${householdId}`)
})

const taxonomy = [{ flow: 'expense' as const, major: '식비', sub: '카페' }]
const findCategoryId = (flow: string, major: string, sub: string) =>
  flow === 'expense' && major === '식비' && sub === '카페' ? cafeId : null

test('uses user cache, then history, then AI and caches the AI result', async () => {
  await upsertMerchantLookup(
    householdId,
    {
      normMerchant: normalizeMerchant('단골카페'),
      categoryId: cafeId,
      flow: 'expense',
    },
    'user',
  )

  const output = await resolveSuggestions({
    householdId,
    items: [
      { merchant: '단골카페', amount: 5_000, baseFlow: 'expense', bsSuggestCategoryId: null },
      { merchant: '이력집', amount: 8_000, baseFlow: 'expense', bsSuggestCategoryId: null },
      { merchant: '완전미지', amount: 4_000, baseFlow: 'expense', bsSuggestCategoryId: null },
    ],
    historySuggest: (merchant) => merchant === '이력집'
      ? { flow: 'expense', major: '식비', sub: '카페', matched: 'norm' }
      : null,
    amountRepeatIndex: new Map(),
    taxonomy,
    examples: [],
    findCategoryId,
    aiSetting: null,
  })

  expect(output[0]).toMatchObject({ sugSource: 'user', categoryId: cafeId })
  expect(output[1]).toMatchObject({
    sugSource: 'history',
    historyMatch: 'norm',
    categoryId: cafeId,
  })
  expect(output[2]).toMatchObject({ sugSource: 'ai', categoryId: cafeId })
  expect(vi.mocked(classifyUnknownMerchants).mock.calls[0][0].merchants)
    .toEqual(['완전미지'])

  vi.mocked(classifyUnknownMerchants).mockClear()
  const cached = await resolveSuggestions({
    householdId,
    items: [
      { merchant: '완전미지', amount: 4_000, baseFlow: 'expense', bsSuggestCategoryId: null },
    ],
    historySuggest: () => null,
    amountRepeatIndex: new Map(),
    taxonomy,
    examples: [],
    findCategoryId,
    aiSetting: null,
  })

  expect(cached[0].sugSource).toBe('ai')
  expect(classifyUnknownMerchants).not.toHaveBeenCalled()
})

test('keeps aggregators in review evidence unless exact amount repeats', async () => {
  const amountRepeatIndex = new Map([
    [
      `${normalizeMerchant('네이버페이멤버십')}|4900`,
      { count: 3, categoryId: cafeId },
    ],
  ])
  const output = await resolveSuggestions({
    householdId,
    items: [
      { merchant: '쿠팡', amount: 33_000, baseFlow: 'expense', bsSuggestCategoryId: cafeId },
      { merchant: '네이버페이멤버십', amount: 4_900, baseFlow: 'expense', bsSuggestCategoryId: null },
    ],
    historySuggest: (merchant) => merchant === '쿠팡'
      ? { flow: 'expense', major: '식비', sub: '카페', matched: 'norm' }
      : null,
    amountRepeatIndex,
    taxonomy,
    examples: [],
    findCategoryId,
    aiSetting: null,
  })

  expect(output[0]).toMatchObject({ alwaysConfirm: true, exactAmountRepeat: false })
  expect(output[1]).toMatchObject({
    alwaysConfirm: true,
    exactAmountRepeat: true,
    categoryId: cafeId,
  })
})

test('locked source flow ignores incompatible cache and history suggestions', async () => {
  await upsertMerchantLookup(
    householdId,
    {
      normMerchant: normalizeMerchant('급여성가맹점'),
      categoryId: cafeId,
      flow: 'income',
    },
    'user',
  )

  const [output] = await resolveSuggestions({
    householdId,
    items: [{
      merchant: '급여성가맹점',
      amount: 12_000,
      baseFlow: 'expense',
      bsSuggestCategoryId: cafeId,
      lockFlow: true,
    }],
    historySuggest: () => ({
      flow: 'income',
      major: '수입',
      sub: '급여',
      matched: 'norm',
    }),
    amountRepeatIndex: new Map(),
    taxonomy,
    examples: [],
    findCategoryId,
    aiSetting: '0',
  })

  expect(output).toMatchObject({
    flow: 'expense',
    categoryId: cafeId,
    sugSource: 'banksalad',
  })
})
