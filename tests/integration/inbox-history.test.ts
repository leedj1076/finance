import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { GET } from '@/app/api/inbox/history/route'
import { db } from '@/db/client'
import { households, importInbox, transactions } from '@/db/schema'
import * as actions from '@/features/inbox/history-actions'
import * as queries from '@/features/inbox/history-queries'
import * as staging from '@/features/inbox/staging'

const auth = vi.hoisted(() => ({ householdId: '' }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => ({ householdId: auth.householdId }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const householdIds: string[] = []
const key = { source: 'card:hyundai', processedOn: '2026-09-03' }
const base = {
  owner: 'YJ', date: '2026-08-10', merchant: '기록 테스트', amount: 5000,
  flow: 'expense' as const, bsCat1: '__source:card:hyundai',
  createdAt: new Date('2026-09-02T15:00:00Z'),
}

beforeAll(async () => {
  const rows = await db.insert(households).values([{ name: 'TEST-history' }, { name: 'TEST-history-foreign' }]).returning()
  householdIds.push(...rows.map((row) => row.id))
  auth.householdId = rows[0].id
})

afterAll(async () => {
  if (householdIds.length) await db.delete(households).where(inArray(households.id, householdIds))
})

test('history details isolate the source, Korea upload day and household, and paginate every status', async () => {
  const rows = Array.from({ length: 52 }, (_, index) => ({
    ...base, householdId: auth.householdId, importUid: crypto.randomUUID(),
    merchant: `기록-${index}`, status: index === 0 ? 'done' as const : index === 1 ? 'pending' as const : 'dismissed' as const,
  }))
  await db.insert(importInbox).values([
    ...rows,
    { ...base, householdId: householdIds[1], importUid: crypto.randomUUID(), merchant: '다른 가구' },
    { ...base, householdId: auth.householdId, importUid: crypto.randomUUID(), merchant: '다른 날', createdAt: new Date('2026-09-02T14:59:59Z') },
    { ...base, householdId: auth.householdId, importUid: crypto.randomUUID(), merchant: '다른 소스', bsCat1: '생활' },
  ])
  const groups = await queries.getInboxHistory(auth.householdId)
  expect(groups.find((row) => row.source === key.source && row.processedOn === key.processedOn))
    .toMatchObject({ pending: 1, done: 1, dismissed: 50 })

  const first = await queries.getInboxHistoryItems(auth.householdId, { ...key, status: 'all', page: 1 })
  const second = await queries.getInboxHistoryItems(auth.householdId, { ...key, status: 'all', page: 2 })
  expect(first.total).toBe(52)
  expect(first.items).toHaveLength(50)
  expect(second.items).toHaveLength(2)
  expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(52)
  expect([...first.items, ...second.items].every((row) => row.merchant?.startsWith('기록-'))).toBe(true)
  const done = await queries.getInboxHistoryItems(auth.householdId, { ...key, status: 'done', page: 1 })
  expect(done.total).toBe(1)
  expect(done.items[0]).toMatchObject({ merchant: '기록-0', status: 'done', canRestore: false })
  const directRead = await actions.loadInboxHistoryItems({ ...key, status: 'done', page: 1 })
  expect(directRead.data).toMatchObject({ total: 1, items: [{ merchant: '기록-0', status: 'done' }] })
  const response = await GET(new Request('http://localhost:3000/api/inbox/history?source=card%3Ahyundai&processedOn=2026-09-03&status=all&page=2'))
  expect(response.status).toBe(200)
  const { data } = await response.json()
  expect(data).toMatchObject({ total: 52, page: 2, pageSize: 50 })
  expect(data.items).toHaveLength(2)
  expect(data.items.every((row: { merchant: string }) => row.merchant.startsWith('기록-'))).toBe(true)
})

test('restore changes only excluded household rows not already in the ledger, preserves data and is idempotent', async () => {
  const [excluded, pending, done, foreign, alreadyInLedger] = await db.insert(importInbox).values([
    { status: 'dismissed' as const, householdId: auth.householdId },
    { status: 'pending' as const, householdId: auth.householdId },
    { status: 'done' as const, householdId: auth.householdId },
    { status: 'dismissed' as const, householdId: householdIds[1] },
    { status: 'dismissed' as const, householdId: auth.householdId },
  ].map((scope) => ({ ...base, ...scope, importUid: crypto.randomUUID(), memo: '보존할 메모', confidence: 'high' }))).returning()
  await db.insert(transactions).values({
    householdId: auth.householdId, importUid: alreadyInLedger.importUid, date: base.date, amount: base.amount, flow: 'expense',
  })
  // A different household having the same UID must not block this household's restoration.
  await db.insert(transactions).values({
    householdId: householdIds[1], importUid: excluded.importUid, date: base.date, amount: base.amount, flow: 'expense',
  })
  const result = await actions.restoreInboxItems([excluded.id, excluded.id, pending.id, done.id, foreign.id, alreadyInLedger.id])
  expect(result).toMatchObject({ restoredIds: [excluded.id] })
  const updated = await db.select().from(importInbox).where(inArray(importInbox.id, [excluded.id, pending.id, done.id, foreign.id, alreadyInLedger.id])).orderBy(importInbox.id)
  expect(updated.map((row) => row.status)).toEqual(['pending', 'pending', 'done', 'dismissed', 'dismissed'])
  expect(updated[0]).toMatchObject({ importUid: excluded.importUid, createdAt: excluded.createdAt, amount: 5000, memo: '보존할 메모', confidence: 'review' })
  expect(await actions.restoreInboxItems([excluded.id])).toMatchObject({ restoredIds: [] })
  expect(await db.select().from(transactions).where(and(eq(transactions.householdId, auth.householdId), eq(transactions.importUid, excluded.importUid)))).toHaveLength(0)
})

test('failed duplicate refresh rolls back restoration rather than reporting failure after changing the row', async () => {
  const [row] = await db.insert(importInbox).values({ ...base, householdId: auth.householdId,
    importUid: crypto.randomUUID(), status: 'dismissed', confidence: 'high',
  }).returning()
  const refresh = vi.spyOn(staging, 'refreshDuplicateFlags').mockRejectedValueOnce(new Error('duplicate check unavailable'))
  try {
    await expect(actions.restoreInboxItems([row.id])).rejects.toThrow('duplicate check unavailable')
    const [saved] = await db.select().from(importInbox).where(and(eq(importInbox.householdId, auth.householdId), eq(importInbox.id, row.id)))
    expect(saved).toMatchObject({ status: 'dismissed', confidence: 'high' })
  } finally {
    refresh.mockRestore()
  }
})

test('an older duplicate refresh cannot erase the warning of a newly restored row', async () => {
  const merchant = `복원 중복 경합-${crypto.randomUUID()}`
  const [row] = await db.insert(importInbox).values({ ...base, householdId: auth.householdId,
    importUid: crypto.randomUUID(), status: 'dismissed', merchant,
  }).returning()
  await db.insert(transactions).values({ householdId: auth.householdId, date: base.date,
    amount: base.amount, flow: 'expense', rawMerchant: merchant, source: 'card:samsung',
  })
  // Pause A between real reads and writes; restore B completes before A resumes.
  const interleaved: Pick<typeof db, 'select' | 'transaction'> = {
    select: db.select.bind(db),
    transaction: async (callback, config) => {
      await actions.restoreInboxItems([row.id])
      return db.transaction(callback, config)
    },
  }
  await staging.refreshDuplicateFlags(auth.householdId, interleaved)
  const [saved] = await db.select().from(importInbox).where(and(eq(importInbox.householdId, auth.householdId), eq(importInbox.id, row.id)))
  expect(saved.status).toBe('pending')
  expect(saved.dupNote).toContain('가계부에 이미 있음')
})
