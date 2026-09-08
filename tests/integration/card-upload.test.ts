import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { accounts, categories, households, importBatches, importInbox, transactions } from '@/db/schema'
import { processInbox } from '@/features/inbox/actions'
import { upsertMerchantLookup } from '@/features/inbox/merchant-lookup'
import { normalizeMerchant } from '@/features/inbox/normalize'
import { refreshDuplicateFlags } from '@/features/inbox/staging'
import { uploadCardStatement } from '@/features/inbox/upload-action'
import { cardFingerprint } from '@/features/inbox/parsers/cards'
import { HYUNDAI_TEST_PASSWORD, secureHyundaiFixture } from '../fixtures/hyundai-secure'

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
vi.mock('@/features/inbox/ai-classify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/inbox/ai-classify')>()),
  aiFallbackEnabled: () => false,
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
let accountId: number
let sameIssuerAccountId: number
let wrongOwnerAccountId: number
let inactiveAccountId: number
let nonCardAccountId: number
let foreignAccountId: number

function makeFormData() {
  const formData = new FormData()
  formData.set('file', new File([CARD_HTML], 'statement.xls', { type: 'application/vnd.ms-excel' }))
  formData.set('issuer', 'hyundai')
  formData.set('owner', 'DJ')
  formData.set('accountId', String(accountId))
  return formData
}

function makeSingleRowFormData(merchant: string, date: string, amount: number) {
  const html = Buffer.from(`
    <html><body><table>
    <tr><td>이용일</td><td>이용카드</td><td>이용가맹점</td><td>이용금액</td><td>결제원금</td></tr>
    <tr><td>${date.replaceAll('-', '.')}</td><td>카드</td><td>${merchant}</td><td>${amount.toLocaleString('en-US')}</td><td>${amount.toLocaleString('en-US')}</td></tr>
    </table></body></html>`, 'utf8')
  const formData = new FormData()
  formData.set('file', new File([html], 'single-row.xls', { type: 'application/vnd.ms-excel' }))
  formData.set('issuer', 'hyundai')
  formData.set('owner', 'DJ')
  formData.set('accountId', String(accountId))
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
  const [account] = await db
    .insert(accounts)
    .values({
      householdId: context.householdId,
      name: 'DJ 현대 테스트카드',
      owner: 'DJ',
      type: 'card',
    })
    .returning({ id: accounts.id })
  accountId = account.id
  const [sameIssuerAccount] = await db
    .insert(accounts)
    .values({
      householdId: context.householdId,
      name: 'DJ 현대 두번째카드',
      owner: 'DJ',
      type: 'card',
    })
    .returning({ id: accounts.id })
  sameIssuerAccountId = sameIssuerAccount.id
  await db
    .insert(accounts)
    .values({
      householdId: context.householdId,
      name: 'DJ 신한 테스트카드',
      owner: 'DJ',
      type: 'card',
    })
  const invalidAccounts = await db
    .insert(accounts)
    .values([
      {
        householdId: context.householdId,
        name: 'YJ 신한 테스트카드',
        owner: 'YJ',
        type: 'card',
      },
      {
        householdId: context.householdId,
        name: 'DJ 신한 비활성카드',
        owner: 'DJ',
        type: 'card',
        active: false,
      },
      {
        householdId: context.householdId,
        name: 'DJ 신한 테스트계좌',
        owner: 'DJ',
        type: 'cash',
      },
      {
        householdId: householdIds[1],
        name: 'DJ 신한 다른가구카드',
        owner: 'DJ',
        type: 'card',
      },
    ])
    .returning({ id: accounts.id, name: accounts.name })
  wrongOwnerAccountId = invalidAccounts.find((row) => row.name === 'YJ 신한 테스트카드')!.id
  inactiveAccountId = invalidAccounts.find((row) => row.name === 'DJ 신한 비활성카드')!.id
  nonCardAccountId = invalidAccounts.find((row) => row.name === 'DJ 신한 테스트계좌')!.id
  foreignAccountId = invalidAccounts.find((row) => row.name === 'DJ 신한 다른가구카드')!.id
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
  expect(result.message).toContain('자동 분류 2건')
  expect(result.message).toContain('확인 필요 0건')

  const rows = await db
    .select({
      importUid: importInbox.importUid,
      bsCat1: importInbox.bsCat1,
      categoryId: importInbox.categoryId,
      sugSource: importInbox.sugSource,
      pay: importInbox.pay,
      accountId: importInbox.accountId,
      flow: importInbox.flow,
      confidence: importInbox.confidence,
    })
    .from(importInbox)
    .where(and(eq(importInbox.householdId, context.householdId), eq(importInbox.status, 'pending')))
    .orderBy(importInbox.id)

  expect(rows).toHaveLength(2)
  expect(rows[0].importUid).not.toBe(rows[1].importUid)
  expect(rows.every((row) => row.categoryId === categoryId)).toBe(true)
  expect(rows.every((row) => row.sugSource === 'history')).toBe(true)
  expect(rows.every((row) => row.pay === '현대카드' && row.flow === 'expense')).toBe(true)
  expect(rows.every((row) => row.accountId === accountId)).toBe(true)
  expect(rows.every((row) => row.bsCat1 === '__source:card:hyundai')).toBe(true)
  expect(rows.every((row) => row.confidence === 'high')).toBe(true)
})

test('duplicate demotion remains review after the duplicate is cleared', async () => {
  const [duplicate] = await db
    .insert(transactions)
    .values({
      householdId: context.householdId,
      date: '2026-08-03',
      flow: 'expense',
      categoryId,
      memo: '스타벅스 강남점',
      rawMerchant: '스타벅스 강남점',
      amount: 6500,
      source: 'manual',
    })
    .returning({ id: transactions.id })

  await refreshDuplicateFlags(context.householdId)
  const flagged = await db
    .select({ id: importInbox.id, dupNote: importInbox.dupNote, confidence: importInbox.confidence })
    .from(importInbox)
    .where(and(eq(importInbox.householdId, context.householdId), eq(importInbox.status, 'pending')))
    .orderBy(importInbox.id)
  expect(flagged.filter((row) => row.dupNote)).toHaveLength(1)
  expect(flagged.find((row) => row.dupNote)?.confidence).toBe('review')
  expect(flagged.find((row) => !row.dupNote)?.confidence).toBe('high')

  await db
    .delete(transactions)
    .where(and(eq(transactions.householdId, context.householdId), eq(transactions.id, duplicate.id)))
  await refreshDuplicateFlags(context.householdId)
  const cleared = await db
    .select({ id: importInbox.id, dupNote: importInbox.dupNote, confidence: importInbox.confidence })
    .from(importInbox)
    .where(and(eq(importInbox.householdId, context.householdId), eq(importInbox.status, 'pending')))
    .orderBy(importInbox.id)
  expect(cleared.every((row) => row.dupNote === null)).toBe(true)
  expect(cleared.find((row) => row.id === flagged.find((row) => row.dupNote)?.id)?.confidence)
    .toBe('review')
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

test('card uploads stay expense when cache suggests another flow', async () => {
  await upsertMerchantLookup(
    context.householdId,
    {
      normMerchant: normalizeMerchant('급여성가맹점'),
      categoryId,
      flow: 'income',
    },
    'user',
  )

  const result = await uploadCardStatement(
    makeSingleRowFormData('급여성가맹점', '2026-08-21', 12_000),
  )
  expect(result.error).toBeUndefined()
  expect(result.message).toContain('확인 필요 1건')

  const [row] = await db
    .select({
      flow: importInbox.flow,
      categoryId: importInbox.categoryId,
      sugSource: importInbox.sugSource,
      confidence: importInbox.confidence,
    })
    .from(importInbox)
    .where(
      and(
        eq(importInbox.householdId, context.householdId),
        eq(importInbox.merchant, '급여성가맹점'),
      ),
    )
  expect(row).toEqual({
    flow: 'expense',
    categoryId: null,
    sugSource: null,
    confidence: 'review',
  })
})

test('uses the selected eligible card for every inserted statement row', async () => {
  const formData = makeSingleRowFormData('선택카드 검증 가맹점', '2026-08-24', 18_000)
  formData.set('accountId', String(sameIssuerAccountId))

  const result = await uploadCardStatement(formData)
  expect(result.error).toBeUndefined()

  const rows = await db
    .select({ accountId: importInbox.accountId })
    .from(importInbox)
    .where(and(
      eq(importInbox.householdId, context.householdId),
      eq(importInbox.merchant, '선택카드 검증 가맹점'),
    ))
  expect(rows).toEqual([{ accountId: sameIssuerAccountId }])
})

test('rejects foreign, inactive, wrong-owner, wrong-issuer, non-card, and invalid ids before insert', async () => {
  const invalidSelections: Array<[string, FormDataEntryValue]> = [
    ['wrong-issuer', String(accountId)],
    ['wrong-owner', String(wrongOwnerAccountId)],
    ['inactive', String(inactiveAccountId)],
    ['foreign', String(foreignAccountId)],
    ['non-card', String(nonCardAccountId)],
    ['zero', '0'],
    ['decimal', '1.5'],
    ['missing', '999999999'],
    ['blank', ''],
    ['non-string', new File(['not-an-id'], 'account.txt')],
  ]
  const merchants: string[] = []

  for (const [label, selectedId] of invalidSelections) {
    const merchant = `선택거부 ${label}`
    merchants.push(merchant)
    const formData = makeSingleRowFormData(merchant, '2026-08-25', 19_000)
    formData.set('issuer', 'shinhan')
    formData.set('accountId', selectedId)

    expect((await uploadCardStatement(formData)).error).toBeDefined()
  }

  const rows = await db
    .select({ merchant: importInbox.merchant })
    .from(importInbox)
    .where(and(
      eq(importInbox.householdId, context.householdId),
      inArray(importInbox.merchant, merchants),
    ))
  expect(rows).toHaveLength(0)
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

test('Shinhan partial cancellation survives staging and apply, and reupload stays idempotent', async () => {
  const html = `<html><body>
    <table>
      <tr><th>이용일</th><th>이용가맹점</th><th>이용금액</th></tr>
      <tr><td>2026.08.25</td><td>부분취소 테스트</td><td>8,000</td></tr>
      <tr><td>합계</td><td></td><td>8,000</td></tr>
    </table>
    <table>
      <tr><th>이용일</th><th>이용가맹점</th><th>원거래금액</th><th>취소금액</th></tr>
      <tr><td>2026.08.25</td><td>부분취소 테스트</td><td>8,000</td><td>5,000</td></tr>
    </table>
  </body></html>`
  const form = new FormData()
  form.set('file', new File([html], 'shinhan.xls'))
  form.set('issuer', 'shinhan')
  form.set('owner', 'DJ')
  const first = await uploadCardStatement(form)
  expect(first.error).toBeUndefined()
  expect(first.message).toContain('인박스에 2건 추가')
  const staged = await db.select().from(importInbox).where(and(
    eq(importInbox.householdId, context.householdId), eq(importInbox.merchant, '부분취소 테스트'),
  )).orderBy(importInbox.id)
  expect(staged.map((row) => row.amount)).toEqual([8000, -5000])
  expect(new Set(staged.map((row) => row.importUid)).size).toBe(2)

  const apply = new FormData()
  apply.set('intent', 'apply')
  for (const row of staged) {
    apply.append('ids', String(row.id))
    apply.set(`flow_${row.id}`, 'expense')
    apply.set(`category_${row.id}`, String(categoryId))
  }
  await expect(processInbox(apply)).rejects.toThrow('REDIRECT:/inbox?notice=')
  const posted = await db.select().from(transactions).where(and(
    eq(transactions.householdId, context.householdId), eq(transactions.source, 'card:shinhan'),
  )).orderBy(transactions.id)
  expect(posted.map((row) => ({ amount: row.amount, flow: row.flow }))).toEqual([
    { amount: 8000, flow: 'expense' }, { amount: -5000, flow: 'expense' },
  ])
  expect(posted.reduce((total, row) => total + row.amount, 0)).toBe(3000)
  const repeated = await uploadCardStatement(form)
  expect(repeated.error).toBeUndefined()
  expect(repeated.message).toContain('인박스에 0건 추가')
  expect(repeated.message).toContain('이미 처리 2건')
})

test('Hyundai secure HTML validates passwords before staging, keeps refunds and reuploads safely', async () => {
  const form = new FormData()
  form.set('file', new File([secureHyundaiFixture()], 'hyundai.html', { type: 'text/html' }))
  form.set('issuer', 'hyundai')
  form.set('owner', 'DJ')
  form.set('accountId', String(accountId))
  const readFixtureRows = () => db.select().from(importInbox).where(and(
    eq(importInbox.householdId, context.householdId), inArray(importInbox.merchant, ['테스트 상점', '테스트 환불']),
  )).orderBy(importInbox.date)

  expect((await uploadCardStatement(form)).error).toContain('비밀번호를 입력')
  form.set('password', 'wrong-password')
  const wrong = await uploadCardStatement(form)
  expect(wrong.error).toContain('비밀번호가 맞지 않거나')
  expect(JSON.stringify(wrong)).not.toContain('wrong-password')
  expect(await readFixtureRows()).toHaveLength(0)

  form.set('password', HYUNDAI_TEST_PASSWORD)
  const first = await uploadCardStatement(form)
  expect(first.error).toBeUndefined()
  expect(first.message).toContain('인박스에 2건 추가')
  const staged = await readFixtureRows()
  expect(staged.map((row) => [row.date, row.amount])).toEqual([['2025-12-24', 12000], ['2026-01-02', -3000]])
  expect(staged.every((row) => row.accountId === accountId && row.status === 'pending')).toBe(true)
  expect(JSON.stringify(staged)).not.toContain(HYUNDAI_TEST_PASSWORD)
  const repeated = await uploadCardStatement(form)
  expect(repeated.message).toContain('인박스에 0건 추가')
  expect(repeated.message).toContain('이미 처리 2건')
  expect(await readFixtureRows()).toHaveLength(2)

  form.set('issuer', 'shinhan')
  expect((await uploadCardStatement(form)).error).toContain('현대카드')
})
