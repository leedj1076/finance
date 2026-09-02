import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { categories, households, importBatches, importInbox, transactions } from '@/db/schema'
import { processInbox } from '@/features/inbox/actions'
import { uploadCardStatement } from '@/features/inbox/upload-action'
import { cardFingerprint } from '@/features/inbox/parsers/cards'

const context = vi.hoisted(() => ({ householdId: '' }))

vi.mock('@/lib/household', () => ({
  requireHousehold: async () => ({
    userId: 'card-upload-test-user',
    householdId: context.householdId,
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) },
}))

const CARD_HTML = Buffer.from(`
<html><body><table>
<tr><td>이용일</td><td>이용카드</td><td>이용가맹점</td><td>이용금액</td><td>결제원금</td></tr>
<tr><td>2026.08.03</td><td>카드</td><td>스타벅스 강남점</td><td>6,500</td><td>6,500</td></tr>
<tr><td>2026.08.03</td><td>카드</td><td>스타벅스 강남점</td><td>6,500</td><td>6,500</td></tr>
<tr><td>합계</td><td></td><td></td><td>13,000</td><td></td></tr>
</table></body></html>`, 'utf8')

const householdIds: string[] = []
let categoryId: number

function makeFormData() {
  const formData = new FormData()
  formData.set('file', new File([CARD_HTML], 'statement.xls', { type: 'application/vnd.ms-excel' }))
  formData.set('issuer', 'hyundai')
  formData.set('owner', 'DJ')
  return formData
}

beforeAll(async () => {
  const created = await db
    .insert(households)
    .values([{ name: 'TEST-card-current' }, { name: 'TEST-card-other' }])
    .returning({ id: households.id })
  householdIds.push(...created.map((row) => row.id))
  context.householdId = householdIds[0]

  const [category] = await db
    .insert(categories)
    .values({ householdId: context.householdId, kind: 'expense', major: '식비', sub: '카페' })
    .returning({ id: categories.id })
  categoryId = category.id
  await db.insert(transactions).values({
    householdId: context.householdId,
    date: '2026-01-01',
    flow: 'expense',
    categoryId,
    memo: '스타벅스 강남점',
    rawMerchant: '스타벅스 강남점',
    amount: 1000,
    source: 'manual',
  })

  const row = { date: '2026-08-03', merchant: '스타벅스 강남점', amount: 6500 }
  await db.insert(importInbox).values({
    householdId: householdIds[1],
    importUid: cardFingerprint('hyundai', 'DJ', row, 0),
    owner: 'DJ',
    date: row.date,
    merchant: row.merchant,
    amount: row.amount,
    flow: 'expense',
  })
})

afterAll(async () => {
  if (householdIds.length > 0) {
    await db.delete(households).where(inArray(households.id, householdIds))
  }
})

test('stages same-row occurrences with household-scoped history suggestions', async () => {
  const result = await uploadCardStatement(makeFormData())
  expect(result.error).toBeUndefined()
  expect(result.message).toContain('인박스에 2건 추가')

  const rows = await db
    .select({
      importUid: importInbox.importUid,
      bsCat1: importInbox.bsCat1,
      categoryId: importInbox.categoryId,
      sugSource: importInbox.sugSource,
      pay: importInbox.pay,
      flow: importInbox.flow,
    })
    .from(importInbox)
    .where(and(eq(importInbox.householdId, context.householdId), eq(importInbox.status, 'pending')))
    .orderBy(importInbox.id)

  expect(rows).toHaveLength(2)
  expect(rows[0].importUid).not.toBe(rows[1].importUid)
  expect(rows.every((row) => row.categoryId === categoryId)).toBe(true)
  expect(rows.every((row) => row.sugSource === 'history')).toBe(true)
  expect(rows.every((row) => row.pay === '현대카드' && row.flow === 'expense')).toBe(true)
  expect(rows.every((row) => row.bsCat1 === '__source:card:hyundai')).toBe(true)
})

test('re-upload is idempotent within the same household', async () => {
  const result = await uploadCardStatement(makeFormData())
  expect(result.error).toBeUndefined()
  expect(result.message).toContain('인박스에 0건 추가')
  expect(result.message).toContain('이미 처리 2건')

  const rows = await db
    .select({ id: importInbox.id })
    .from(importInbox)
    .where(eq(importInbox.householdId, context.householdId))
  expect(rows).toHaveLength(2)
})

test('applying staged card rows records card issuer source', async () => {
  const inboxRows = await db
    .select({ id: importInbox.id })
    .from(importInbox)
    .where(and(eq(importInbox.householdId, context.householdId), eq(importInbox.status, 'pending')))
  const formData = new FormData()
  formData.set('intent', 'apply')
  for (const row of inboxRows) {
    formData.append('ids', String(row.id))
    formData.set(`flow_${row.id}`, 'expense')
    formData.set(`category_${row.id}`, String(categoryId))
  }

  await expect(processInbox(formData)).rejects.toThrow('REDIRECT:/inbox?notice=')

  const applied = await db
    .select({ source: transactions.source })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, context.householdId),
        eq(transactions.source, 'card:hyundai'),
      ),
    )
  expect(applied).toHaveLength(2)

  const [batch] = await db
    .select({ source: importBatches.source })
    .from(importBatches)
    .where(eq(importBatches.householdId, context.householdId))
  expect(batch.source).toBe('card:hyundai')
})

test('BankSalad-like pay label does not collide with the internal card source marker', async () => {
  const importUid = 'banksalad-pay-label-collision'
  const [inboxRow] = await db
    .insert(importInbox)
    .values({
      householdId: context.householdId,
      importUid,
      owner: 'DJ',
      date: '2026-08-20',
      merchant: '테스트 가맹점',
      amount: 12000,
      flow: 'expense',
      bsCat1: '식비',
      bsCat2: '카페',
      pay: '현대카드',
      categoryId,
    })
    .returning({ id: importInbox.id })

  const formData = new FormData()
  formData.set('intent', 'apply')
  formData.set('ids', String(inboxRow.id))
  formData.set(`flow_${inboxRow.id}`, 'expense')
  formData.set(`category_${inboxRow.id}`, String(categoryId))
  await expect(processInbox(formData)).rejects.toThrow('REDIRECT:/inbox?notice=')

  const [applied] = await db
    .select({ source: transactions.source })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, context.householdId),
        eq(transactions.importUid, importUid),
      ),
    )
  expect(applied.source).toBe('banksalad:dj')
})
