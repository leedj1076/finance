import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { accounts, categories, households, importInbox, merchantLookup, settings } from '@/db/schema'
import { runImport } from '@/features/inbox/import-service'
import type { ImportEvent } from '@/features/inbox/import-progress'
import * as staging from '@/features/inbox/staging'

const external = vi.hoisted(() => ({
  create: (() => Promise.resolve({ output_text: '[]' })) as (_request: unknown, options: { signal: AbortSignal; maxRetries: number }) => Promise<{ output_text: string }>,
}))
vi.mock('openai', () => ({ default: class {
  responses = { create: external.create }
} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let householdId: string
let accountId: number
const savedApiKey = process.env.OPENAI_API_KEY
beforeAll(async () => {
  const [household] = await db.insert(households).values({ name: 'TEST-import-ai-deadline' }).returning()
  householdId = household.id
  const [account] = await db.insert(accounts).values({ householdId, name: 'DJ 현대 합성카드', owner: 'DJ', type: 'card' }).returning()
  accountId = account.id
  await db.insert(categories).values({ householdId, kind: 'expense', major: '식비', sub: '카페' })
  await db.insert(settings).values({ householdId, key: 'ai_fallback_enabled', value: '1' })
  process.env.OPENAI_API_KEY = 'synthetic-test-key'
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
afterAll(async () => {
  if (savedApiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = savedApiKey
  await db.delete(households).where(inArray(households.id, [householdId]))
})

test('timed-out AI saves original card UIDs for review and cannot write late classifications; result waits for finalization', async () => {
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  let releaseAi!: (response: { output_text: string }) => void
  const ai = new Promise<{ output_text: string }>((resolve) => { releaseAi = resolve })
  let requestOptions: { signal: AbortSignal; maxRetries: number } | undefined
  external.create = (_request, options) => { requestOptions = options; entered(); return ai }
  let finalizing!: () => void
  const reachedFinalization = new Promise<void>((resolve) => { finalizing = resolve })
  let releaseFinalization!: () => void
  const finalizationGate = new Promise<void>((resolve) => { releaseFinalization = resolve })
  const actualRefresh = staging.refreshDuplicateFlags
  vi.spyOn(staging, 'refreshDuplicateFlags').mockImplementationOnce(async (...args) => {
    finalizing()
    await finalizationGate
    return actualRefresh(...args)
  })
  const form = new FormData()
  form.set('issuer', 'hyundai')
  form.set('owner', 'DJ')
  form.set('accountId', String(accountId))
  form.set('file', new File(['<html><table><tr><td>이용일</td><td>이용카드</td><td>이용가맹점</td><td>이용금액</td><td>결제원금</td></tr><tr><td>2026.08.31</td><td>카드</td><td>지연 합성상점</td><td>12500</td><td>12500</td></tr><tr><td>2026.08.31</td><td>카드</td><td>지연 합성환불</td><td>-3000</td><td>-3000</td></tr></table></html>'], 'synthetic.xls'))
  const events: ImportEvent[] = []
  let settled = false
  const run = runImport(householdId, 'card', form, (event) => {
    events.push(event)
    if (event.phase === 'classifying') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  }).then((result) => { settled = true; return result })
  const stored = () => db.select().from(importInbox).where(eq(importInbox.householdId, householdId)).orderBy(importInbox.id)
  await started
  expect(await stored()).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(29_999)
  expect(settled).toBe(false)
  expect(events.at(-1)).toEqual({ type: 'stage', phase: 'classifying' })
  await vi.advanceTimersByTimeAsync(1)
  expect(requestOptions?.signal.aborted).toBe(true)
  expect(requestOptions?.maxRetries).toBe(0)
  vi.useRealTimers()
  await reachedFinalization
  expect(settled).toBe(false)
  expect(events.at(-1)).toEqual({ type: 'stage', phase: 'finalizing' })
  const beforeFinalization = await stored()
  expect(beforeFinalization.map((row) => [row.merchant, row.amount, row.flow, row.accountId, row.categoryId, row.confidence, row.sugSource])).toEqual([
    ['지연 합성상점', 12500, 'expense', accountId, null, 'review', null],
    ['지연 합성환불', -3000, 'expense', accountId, null, 'review', null],
  ])
  // Literal fingerprints are characterized from the existing unmodified parser.
  expect(beforeFinalization.map((row) => row.importUid)).toEqual([
    '55a452434a5849b94a916c16be8150cb085c9014',
    '81e2712faae8c43b5adc4eccba0dbb88355ee201',
  ])
  releaseFinalization()
  expect(await run).toMatchObject({ added: 2, alreadyProcessed: 0, automatic: 0, review: 2 })
  const saved = await stored()
  releaseAi({ output_text: JSON.stringify([{ merchant: '지연 합성상점', major: '식비', sub: '카페', flow: 'expense', confidence: 'high' }]) })
  await ai
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(await stored()).toEqual(saved)
  expect(await db.select().from(merchantLookup).where(eq(merchantLookup.householdId, householdId))).toEqual([])
})
