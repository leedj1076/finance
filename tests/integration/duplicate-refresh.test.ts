import { eq, inArray } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { db } from '@/db/client'
import { households, importInbox, transactions } from '@/db/schema'
import { refreshDuplicateFlags } from '@/features/inbox/staging'

let householdIds: string[] = []
let householdId: string
const base = { owner: 'DJ', date: '2026-09-01', amount: 1000, flow: 'expense' as const }

beforeEach(async () => {
  const rows = await db.insert(households).values([{ name: 'TEST-duplicate-batch' }, { name: 'TEST-duplicate-batch-foreign' }]).returning()
  householdIds = rows.map((row) => row.id)
  householdId = householdIds[0]
})
afterEach(async () => { await db.delete(households).where(inArray(households.id, householdIds)) })

async function matchingRows(count: number) {
  const rows = Array.from({ length: count }, (_, index) => ({
    ...base, householdId, importUid: crypto.randomUUID(), merchant: `합성 ' 가맹점-${index}`,
    amount: index + 1, dupNote: '이전 경고', confidence: 'high',
  }))
  const pending = await db.insert(importInbox).values(rows).returning()
  await db.insert(transactions).values(rows.map((row) => ({
    householdId, date: row.date, amount: row.amount, flow: row.flow, rawMerchant: row.merchant, source: 'manual',
  })))
  return pending
}

function observedDatabase(beforeTransaction?: () => Promise<void>, failAt?: number) {
  let writes = 0
  const database: Pick<typeof db, 'select' | 'transaction'> = {
    select: db.select.bind(db),
    transaction: async (callback, config) => {
      await beforeTransaction?.()
      return db.transaction(async (tx) => callback(new Proxy(tx, {
        get(target, property, receiver) {
          if (property === 'update') return (...args: Parameters<typeof tx.update>) => {
            writes += 1
            if (writes === failAt) throw new Error('synthetic later chunk failure')
            return target.update(...args)
          }
          return Reflect.get(target, property, receiver)
        },
      })), config)
    },
  }
  return { database, writes: () => writes }
}

test('501 matches persist exact per-row notes and confidence across the 500-row boundary with three writes', async () => {
  const before = await matchingRows(501)
  const capture = observedDatabase()
  expect(await refreshDuplicateFlags(householdId, capture.database)).toBe(501)
  expect(capture.writes()).toBe(3)
  const after = await db.select().from(importInbox).where(eq(importInbox.householdId, householdId)).orderBy(importInbox.id)
  expect(after).toEqual(before.map((row) => ({
    ...row, dupNote: `가계부에 이미 있음: ${row.merchant!.slice(0, 20)} (manual)`, confidence: 'review',
  })))
})

test('one ledger transaction is claimed once and clearing obsolete notes never promotes confidence', async () => {
  const rows = await db.insert(importInbox).values([
    { merchant: '동일상점', confidence: 'high' },
    { merchant: '동일상점', confidence: 'review' },
    { merchant: '다른상점', confidence: 'high' },
  ].map((row) => ({ ...base, householdId, importUid: crypto.randomUUID(), dupNote: '이전 경고', ...row }))).returning()
  await db.insert(transactions).values({ householdId, date: base.date, amount: base.amount, flow: 'expense', rawMerchant: '동일상점', source: 'card:samsung' })
  expect(await refreshDuplicateFlags(householdId)).toBe(1)
  expect(await db.select().from(importInbox).where(eq(importInbox.householdId, householdId)).orderBy(importInbox.id)).toEqual([
    { ...rows[0], dupNote: '가계부에 이미 있음: 동일상점 (card:samsung)', confidence: 'review' },
    { ...rows[1], dupNote: null },
    { ...rows[2], dupNote: null },
  ])
  await db.delete(transactions).where(eq(transactions.householdId, householdId))
  const capture = observedDatabase()
  expect(await refreshDuplicateFlags(householdId, capture.database)).toBe(0)
  expect(capture.writes()).toBe(1)
  const cleared = await db.select().from(importInbox).where(eq(importInbox.householdId, householdId)).orderBy(importInbox.id)
  expect(cleared.map((row) => [row.dupNote, row.confidence])).toEqual([[null, 'review'], [null, 'review'], [null, 'high']])
})

test('live status and captured snapshot guards preserve a dismissal, new pending row and foreign household', async () => {
  const [dismissedDuringRefresh, stillPending] = await matchingRows(2)
  const [foreign] = await db.insert(importInbox).values({ ...base, householdId: householdIds[1], importUid: crypto.randomUUID(), merchant: '다른 가구', dupNote: '외부 경고', confidence: 'high' }).returning()
  let newRow: typeof importInbox.$inferSelect
  const capture = observedDatabase(async () => {
    await db.update(importInbox).set({ status: 'dismissed', dupNote: '제외 시 경고' }).where(eq(importInbox.id, dismissedDuringRefresh.id))
    ;[newRow] = await db.insert(importInbox).values({ ...base, householdId, importUid: crypto.randomUUID(), merchant: '새 대기', dupNote: '새 경고', confidence: 'high' }).returning()
  })
  // Return the captured matches, including the match concurrently dismissed.
  expect(await refreshDuplicateFlags(householdId, capture.database)).toBe(2)
  const saved = await db.select().from(importInbox).where(inArray(importInbox.householdId, householdIds)).orderBy(importInbox.id)
  expect(saved).toEqual([
    { ...dismissedDuringRefresh, status: 'dismissed', dupNote: '제외 시 경고' },
    { ...stillPending, dupNote: "가계부에 이미 있음: 합성 ' 가맹점-1 (manual)", confidence: 'review' },
    foreign,
    newRow!,
  ])
})

test('a failure on the second note chunk rolls back both reset and earlier note updates', async () => {
  const before = await matchingRows(501)
  const capture = observedDatabase(undefined, 3)
  await expect(refreshDuplicateFlags(householdId, capture.database)).rejects.toThrow('synthetic later chunk failure')
  expect(capture.writes()).toBe(3)
  expect(await db.select().from(importInbox).where(eq(importInbox.householdId, householdId)).orderBy(importInbox.id)).toEqual(before)
})
