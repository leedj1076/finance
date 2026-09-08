import { eq, inArray } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'

import { POST } from '@/app/api/import/route'
import { db } from '@/db/client'
import { accounts, balanceSnapshots, categories, households, importInbox, settings } from '@/db/schema'
import { type AiMerchantResult } from '@/features/inbox/ai-classify'
import { runImport } from '@/features/inbox/import-service'
import { type ImportEvent } from '@/features/inbox/import-progress'
import { readImportStream } from '@/features/inbox/import-stream'
import { insertInboxRows, resolveStagingSuggestions, loadStagingContext } from '@/features/inbox/staging'
import { uploadBanksaladFiles, uploadCardStatement } from '@/features/inbox/upload-action'
import { HYUNDAI_TEST_PASSWORD, secureHyundaiFixture } from '../fixtures/hyundai-secure'

const context = vi.hoisted(() => ({ householdId: '', failCache: false, classify: (async () => []) as (input: { merchants: string[] }) => Promise<AiMerchantResult[]> }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => ({ householdId: context.householdId, userId: 'import-progress-test' }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => { if (context.failCache) throw new Error('private cache failure') } }))
vi.mock('@/features/inbox/ai-classify', async (original) => ({
  ...(await original<typeof import('@/features/inbox/ai-classify')>()),
  aiFallbackEnabled: (setting: string | null) => setting === '1',
  classifyUnknownMerchants: (input: { merchants: string[] }) => context.classify(input),
}))

const householdIds: string[] = []
beforeEach(() => { context.classify = async () => []; context.failCache = false })
let accountId: number
let categoryId: number
let foreignAccountId: number
beforeAll(async () => {
  const created = await db.insert(households).values([{ name: 'TEST-import-progress' }, { name: 'TEST-import-progress-other' }]).returning({ id: households.id })
  householdIds.push(...created.map((row) => row.id))
  context.householdId = householdIds[0]
  const [account] = await db.insert(accounts).values({ householdId: context.householdId, name: 'DJ 현대 테스트카드', owner: 'DJ', type: 'card' }).returning({ id: accounts.id })
  accountId = account.id
  const [foreign] = await db.insert(accounts).values({ householdId: householdIds[1], name: 'DJ 현대 테스트카드', owner: 'DJ', type: 'card' }).returning({ id: accounts.id })
  foreignAccountId = foreign.id
  const [category] = await db.insert(categories).values({ householdId: context.householdId, kind: 'expense', major: '식비', sub: '외식' }).returning({ id: categories.id })
  categoryId = category.id
  await db.insert(settings).values({ householdId: context.householdId, key: 'ai_fallback_enabled', value: '1' })
})
afterAll(async () => { await db.delete(households).where(inArray(households.id, householdIds)) })

function cardForm(merchant: string, amount = 12500) {
  const form = new FormData()
  form.set('mode', 'card')
  form.set('issuer', 'hyundai')
  form.set('owner', 'DJ')
  form.set('accountId', String(accountId))
  form.set('file', new File([`<html><body><table><tr><td>이용일</td><td>이용카드</td><td>이용가맹점</td><td>이용금액</td><td>결제원금</td></tr><tr><td>2026.08.31</td><td>카드</td><td>${merchant}</td><td>${amount}</td><td>${amount}</td></tr></table></body></html>`], 'card.xls'))
  return form
}
const inboxRows = () => db.select().from(importInbox).where(eq(importInbox.householdId, context.householdId)).orderBy(importInbox.id)
const request = (form: FormData) => new Request('http://localhost:3000/api/import', { method: 'POST', headers: { Origin: 'http://localhost:3000' }, body: form })

test('classifying is visible before external AI settles; saving starts before database inserts', async () => {
  let release!: (rows: AiMerchantResult[]) => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const ai = new Promise<AiMerchantResult[]>((resolve) => { release = resolve })
  context.classify = async () => { entered(); return ai }
  const events: ImportEvent[] = []
  const run = runImport(context.householdId, 'card', cardForm('진행관찰 상점'), (event) => events.push(event))
  const settled = run.then(() => 'finished', () => 'failed')
  expect(await Promise.race([started.then(() => 'started'), settled])).toBe('started')
  expect(events.at(-1)).toEqual({ type: 'stage', phase: 'classifying' })
  expect(await inboxRows()).toHaveLength(0)
  release([{ merchant: '진행관찰 상점', businessType: '식당', major: '식비', sub: '외식', flow: 'expense', confidence: 'high', note: '합성 분류' }])
  const result = await run
  expect(events.map((event) => event.type === 'stage' ? event.phase : event.type)).toEqual(['validating', 'reading', 'matching', 'classifying', 'saving', 'saving', 'finalizing'])
  expect(events.filter((event) => event.type === 'stage' && event.phase === 'saving')).toEqual([{ type: 'stage', phase: 'saving', completed: 0, total: 1 }, { type: 'stage', phase: 'saving', completed: 1, total: 1 }])
  expect(result).toMatchObject({ added: 1, alreadyProcessed: 0, automatic: 0, review: 1 })
  const stored = await inboxRows()
  expect(stored.map((row) => [row.merchant, row.amount, row.categoryId, row.accountId, row.confidence])).toEqual([['진행관찰 상점', 12500, categoryId, accountId, 'review']])
  context.classify = async () => []

  const before = stored.length
  await expect(runImport(context.householdId, 'card', cardForm('저장직전 관찰'), (event) => {
    if (event.phase === 'saving' && event.completed === 0) throw new Error('test observer stopped before insert')
  })).rejects.toThrow()
  expect(await inboxRows()).toHaveLength(before)
})

test('AI observation is omitted for cached, disabled, empty taxonomy and blank-merchant no-op inputs', async () => {
  const stages: ImportEvent[] = []
  const result = await runImport(context.householdId, 'card', cardForm('진행관찰 상점'), (event) => stages.push(event))
  expect(result).toMatchObject({ added: 0, alreadyProcessed: 1 })
  expect(stages.some((event) => event.type === 'stage' && event.phase === 'classifying')).toBe(false)
  const staging = await loadStagingContext(context.householdId)
  const observe = (event: ImportEvent) => stages.push(event)
  const items = [{ merchant: '  ', amount: 1, baseFlow: 'expense' as const, bsSuggestCategoryId: null }]
  const cached = await resolveStagingSuggestions(context.householdId, staging, [{ ...items[0], merchant: '진행관찰 상점' }], staging.taxonomy, observe)
  expect(cached[0]).toMatchObject({ categoryId, sugSource: 'ai' })
  await resolveStagingSuggestions(context.householdId, staging, items, staging.taxonomy, observe)
  await resolveStagingSuggestions(context.householdId, staging, [{ ...items[0], merchant: '새상점' }], [], observe)
  await resolveStagingSuggestions(context.householdId, { ...staging, aiSetting: '0' }, [{ ...items[0], merchant: '새상점' }], staging.taxonomy, observe)
  expect(stages.some((event) => event.type === 'stage' && event.phase === 'classifying')).toBe(false)
})

test('saving counts processed candidates after awaited chunks, while added counts actual inserts', async () => {
  const values = Array.from({ length: 501 }, (_, index) => ({ householdId: context.householdId, importUid: `progress-chunk-${index}`, owner: 'DJ', date: '2026-08-30', merchant: '합성 청크', amount: 1, flow: 'expense' as const }))
  await db.insert(importInbox).values(values[0])
  const stages: ImportEvent[] = []
  const inserted = await insertInboxRows(context.householdId, values, (event) => stages.push(event))
  expect(inserted).toHaveLength(500)
  expect(stages).toEqual([{ type: 'stage', phase: 'saving', completed: 0, total: 501 }, { type: 'stage', phase: 'saving', completed: 500, total: 501 }, { type: 'stage', phase: 'saving', completed: 501, total: 501 }])
  await db.delete(importInbox).where(inArray(importInbox.importUid, values.map((row) => row.importUid)))

  await expect(insertInboxRows(context.householdId, values, (event) => {
    if (event.completed === 500) throw new Error('test observer stops after first insert resolves')
  })).rejects.toThrow('test observer')
  const persisted = await db.select({ uid: importInbox.importUid }).from(importInbox).where(inArray(importInbox.importUid, values.map((row) => row.importUid)))
  expect(persisted).toHaveLength(500)
  expect(persisted.some((row) => row.uid === 'progress-chunk-500')).toBe(false)
  await db.delete(importInbox).where(inArray(importInbox.importUid, values.map((row) => row.importUid)))
})

test('card action, service and actual route preserve signed amounts, selected card and reupload results', async () => {
  const form = cardForm('호환 환불', -3000)
  const first = await uploadCardStatement(form)
  expect(first.error).toBeUndefined()
  expect(first.message).toContain('인박스에 1건 추가')
  const service = await runImport(context.householdId, 'card', form)
  const action = await uploadCardStatement(form)
  expect(action).toEqual({ message: service.message })
  expect(service).toMatchObject({ added: 0, alreadyProcessed: 1, automatic: 0, review: 0 })
  const stream = await readImportStream(await POST(request(form)), () => {})
  expect(stream).toEqual(service)
  const rows = (await inboxRows()).filter((row) => row.merchant === '호환 환불')
  expect(rows.map((row) => [row.amount, row.flow, row.accountId])).toEqual([[-3000, 'expense', accountId]])
})

test('Banksalad action and shared service preserve signed ledger amounts and duplicate results', async () => {
  const workbook = new ExcelJS.Workbook()
  const status = workbook.addWorksheet('뱅샐현황')
  status.getCell('B2').value = '이동재'
  status.addRow([null, '3.재무현황'])
  status.addRow([null, '자유입출금 자산'])
  status.addRow([null, null, '합성통장', null, 1200000])
  const sheet = workbook.addWorksheet('가계부 내역')
  sheet.addRow(['날짜', '시간', '타입', '대분류', '소분류', '내용', '금액', '통화', '결제수단', '메모'])
  sheet.addRow([new Date(Date.UTC(2026, 7, 31)), null, '지출', '알수없음', '', '뱅샐호환 상점', -15000, 'KRW', '합성카드', null])
  const form = new FormData()
  form.set('mode', 'banksalad')
  form.set('files', new File([Buffer.from(await workbook.xlsx.writeBuffer())], 'banksalad.xlsx'))
  form.set('asset_include', 'on')
  const first = await readImportStream(await POST(request(form)), () => {})
  expect(first).toMatchObject({ added: 1, alreadyProcessed: 0, automatic: 0, review: 1 })
  expect(first.message).toContain('자산 1항목 업데이트')
  expect(await db.select({ amount: balanceSnapshots.amount, month: balanceSnapshots.month }).from(balanceSnapshots).where(eq(balanceSnapshots.householdId, context.householdId))).toEqual([{ amount: 1200000, month: '2026-08' }])
  const service = await runImport(context.householdId, 'banksalad', form)
  expect(await uploadBanksaladFiles({}, form)).toEqual({ message: service.message })
  const rows = (await inboxRows()).filter((row) => row.merchant === '뱅샐호환 상점')
  expect(rows.map((row) => [row.amount, row.flow, row.owner, row.pay])).toEqual([[15000, 'expense', 'DJ', '합성카드']])
})

test('a cache invalidation failure after saving emits a safe error, never a premature result', async () => {
  context.failCache = true
  const events: ImportEvent[] = []
  const response = await POST(request(cardForm('캐시실패 합성상점')))
  await expect(readImportStream(response, (event) => events.push(event))).rejects.toMatchObject({ code: 'processing_failed' })
  expect(events.filter((event) => event.type === 'stage').at(-1)).toEqual({ type: 'stage', phase: 'finalizing' })
  expect(events.some((event) => event.type === 'result')).toBe(false)
  expect(JSON.stringify(events)).not.toContain('private cache failure')
  expect((await inboxRows()).filter((row) => row.merchant === '캐시실패 합성상점')).toHaveLength(1)
})

test('route rejects invalid card, files, and excessive counts before starting a stream or inserting rows', async () => {
  const forms: FormData[] = []
  const foreign = cardForm('차단 외부카드'); foreign.set('accountId', String(foreignAccountId)); forms.push(foreign)
  const missing = cardForm('차단 누락'); missing.delete('file'); forms.push(missing)
  const big = cardForm('차단 대용량'); big.set('file', new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'card.xls')); forms.push(big)
  const duplicate = cardForm('차단 중복'); duplicate.append('file', new File(['x'], 'second.xls')); forms.push(duplicate)
  const unexpected = cardForm('차단 예상외'); unexpected.set('other-file', new File(['x'], 'other.xls')); forms.push(unexpected)
  const wrongFormat = cardForm('차단 형식'); wrongFormat.set('file', new File(['text'], 'file.txt')); forms.push(wrongFormat)
  const banksalad = new FormData(); banksalad.set('mode', 'banksalad'); for (let i = 0; i < 3; i++) banksalad.append('files', new File(['x'], 'bank.xlsx')); forms.push(banksalad)
  const before = (await inboxRows()).length
  for (const form of forms) {
    const response = await POST(request(form))
    expect(response.status).toBe(400)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(await response.json()).toMatchObject({ type: 'error', code: 'invalid_input' })
  }
  expect(await inboxRows()).toHaveLength(before)
})

test('real secure parser returns typed retry errors without exposing the source or password', async () => {
  const form = cardForm('사용하지 않음')
  form.set('file', new File([secureHyundaiFixture()], 'secure.html'))
  for (const [password, code] of [['', 'password_required'], ['private-wrong-password', 'password_incorrect']]) {
    form.set('password', password)
    const response = await POST(request(form))
    expect(response.status).toBe(200)
    const events: ImportEvent[] = []
    await expect(readImportStream(response, (event) => events.push(event))).rejects.toMatchObject({ code })
    expect(events.some((event) => event.type === 'result')).toBe(false)
    expect(JSON.stringify(events)).not.toContain('private-wrong-password')
  }
  form.set('password', HYUNDAI_TEST_PASSWORD)
  expect(await readImportStream(await POST(request(form)), () => {})).toMatchObject({ added: 2 })
})
