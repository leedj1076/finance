import { eq, inArray } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import {
  categories,
  households,
  importInbox,
  settings,
  transactions,
} from '@/db/schema'
import {
  aiFallbackEnabled,
  classifyUnknownMerchants,
} from '@/features/inbox/ai-classify'
import { upsertMerchantLookup } from '@/features/inbox/merchant-lookup'
import { normalizeMerchant } from '@/features/inbox/normalize'
import { uploadBanksaladFiles } from '@/features/inbox/upload-action'

const context = vi.hoisted(() => ({ householdId: '' }))

vi.mock('@/lib/household', () => ({
  requireHousehold: async () => ({
    userId: 'banksalad-suggestion-test-user',
    householdId: context.householdId,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/inbox/ai-classify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/inbox/ai-classify')>()),
  aiFallbackEnabled: vi.fn((setting: string | null) => setting === '1'),
  classifyUnknownMerchants: vi.fn(async ({ merchants }: { merchants: string[] }) =>
    merchants.map((merchant) => ({
      merchant,
      businessType: '테스트업종',
      major: '식비',
      sub: '외식',
      flow: 'expense' as const,
      confidence: 'high' as const,
      note: '테스트 분류',
    }))),
}))

const householdIds: string[] = []
let categoryId: number

async function banksaladFile() {
  const workbook = new ExcelJS.Workbook()
  const status = workbook.addWorksheet('뱅샐현황')
  status.getCell('B2').value = '이동재'
  const ledger = workbook.addWorksheet('가계부 내역')
  ledger.addRow(['날짜', '시간', '타입', '대분류', '소분류', '내용', '금액', '통화', '결제수단', '메모'])
  ledger.addRow([
    new Date(Date.UTC(2026, 7, 31)),
    null,
    '지출',
    '알수없음',
    '',
    'AI분류대상',
    -15000,
    'KRW',
    '테스트카드',
    null,
  ])
  return new File(
    [Buffer.from(await workbook.xlsx.writeBuffer())],
    'banksalad.xlsx',
  )
}

beforeAll(async () => {
  const created = await db
    .insert(households)
    .values([{ name: 'TEST-bs-suggest-current' }, { name: 'TEST-bs-suggest-other' }])
    .returning({ id: households.id })
  householdIds.push(...created.map((row) => row.id))
  context.householdId = householdIds[0]

  const [category] = await db
    .insert(categories)
    .values({
      householdId: context.householdId,
      kind: 'expense',
      major: '식비',
      sub: '외식',
    })
    .returning({ id: categories.id })
  categoryId = category.id
  await db.insert(categories).values({
    householdId: context.householdId,
    kind: 'expense',
    major: '숨김',
    sub: '숨김',
    hidden: true,
  })
  const [otherCategory] = await db
    .insert(categories)
    .values({
      householdId: householdIds[1],
      kind: 'expense',
      major: '타가구',
      sub: '분류',
    })
    .returning({ id: categories.id })
  await upsertMerchantLookup(
    householdIds[1],
    {
      normMerchant: normalizeMerchant('AI분류대상'),
      categoryId: otherCategory.id,
      flow: 'expense',
    },
    'user',
  )
  await db.insert(settings).values({
    householdId: context.householdId,
    key: 'ai_fallback_enabled',
    value: '1',
  })
  await db.insert(transactions).values(
    Array.from({ length: 21 }, (_, index) => ({
      householdId: context.householdId,
      date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      flow: 'expense' as const,
      categoryId,
      memo: `최근예시${index + 1}`,
      rawMerchant: `최근예시${index + 1}`,
      amount: 1000 + index,
      source: 'manual',
    })),
  )
})

afterAll(async () => {
  if (householdIds.length > 0) {
    await db.delete(households).where(inArray(households.id, householdIds))
  }
})

test('uses household AI setting, visible taxonomy and latest 20 examples for Banksalad misses', async () => {
  const formData = new FormData()
  formData.set('files', await banksaladFile())
  formData.set('asset_include', 'off')

  const result = await uploadBanksaladFiles({}, formData)
  expect(result.error).toBeUndefined()
  expect(result.message).toContain('자동 분류 0건')
  expect(result.message).toContain('확인 필요 1건')
  expect(aiFallbackEnabled).toHaveBeenCalledWith('1')

  const call = vi.mocked(classifyUnknownMerchants).mock.calls[0][0]
  expect(call.merchants).toEqual(['AI분류대상'])
  expect(call.taxonomy).toEqual([{ flow: 'expense', major: '식비', sub: '외식' }])
  expect(call.examples).toHaveLength(20)
  expect(call.examples[0].merchant).toBe('최근예시21')
  expect(call.examples.some((example) => example.merchant.includes('타가구'))).toBe(false)

  const [row] = await db
    .select({
      categoryId: importInbox.categoryId,
      flow: importInbox.flow,
      sugSource: importInbox.sugSource,
      confidence: importInbox.confidence,
    })
    .from(importInbox)
    .where(eq(importInbox.householdId, context.householdId))
  expect(row).toEqual({
    categoryId,
    flow: 'expense',
    sugSource: 'ai',
    confidence: 'review',
  })
})
