import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { db } from '@/db/client'
import { households, importInbox, transactions } from '@/db/schema'
import { getMonthCloseSummary, getMonthStatuses } from '@/features/month-close/queries'
import { closeMonth, reopenMonth } from '@/features/month-close/service'

let householdId: string
const userId = randomUUID()
beforeEach(async () => {
  const [household] = await db.insert(households).values({ name: 'TEST-month-close' }).returning()
  householdId = household.id
})
afterEach(async () => { await db.delete(households).where(eq(households.id, householdId)) })

async function add(month = '2026-01', amount = 400, importUid?: string) {
  const [row] = await db.insert(transactions).values({ householdId, date: `${month}-15`, flow: 'expense', amount, importUid }).returning()
  return row
}
async function close(month = '2026-01') {
  const summary = await getMonthCloseSummary(householdId, month)
  expect(await closeMonth(householdId, userId, { month, revision: summary.revision, acknowledgeWarnings: true, acknowledgeEmpty: true })).toEqual({ ok: true })
  return summary
}
async function status(month = '2026-01') { return (await getMonthStatuses(householdId, [month]))[0] }

test('new months are open; explicit empty close differs from missing data and is idempotent', async () => {
  expect((await status()).state).toBe('open')
  expect(await closeMonth(householdId, userId, { month: '2026-01', revision: 0, acknowledgeWarnings: true, acknowledgeEmpty: false })).toMatchObject({ ok: false })
  await close()
  expect((await status()).state).toBe('closed')
  await close()
  expect((await status()).revision).toBe(0)
  await reopenMonth(householdId, '2026-01')
  await reopenMonth(householdId, '2026-01')
  expect((await status()).state).toBe('needs_review')
})

test('actual writes invalidate close; no-op and import conflict do not', async () => {
  const row = await add('2026-01', 400, 'same-import')
  await close()
  await db.update(transactions).set({ amount: 400 }).where(and(eq(transactions.householdId, householdId), eq(transactions.id, row.id)))
  expect((await status()).state).toBe('closed')
  await db.insert(transactions).values({ householdId, date: '2026-01-15', flow: 'expense', amount: 400, importUid: 'same-import' }).onConflictDoNothing()
  expect((await status()).state).toBe('closed')
  await db.update(transactions).set({ memo: 'changed' }).where(and(eq(transactions.householdId, householdId), eq(transactions.id, row.id)))
  expect((await status()).state).toBe('needs_review')
  await close()
  await db.delete(transactions).where(and(eq(transactions.householdId, householdId), eq(transactions.id, row.id)))
  expect((await status()).state).toBe('needs_review')
})

test('moving a transaction invalidates both months, and rollback restores their revisions', async () => {
  const row = await add()
  await close('2026-01'); await close('2026-02')
  const before = await getMonthStatuses(householdId, ['2026-01', '2026-02'])
  await expect(db.transaction(async tx => {
    await tx.update(transactions).set({ date: '2026-02-15' }).where(and(eq(transactions.householdId, householdId), eq(transactions.id, row.id)))
    throw new Error('rollback')
  })).rejects.toThrow('rollback')
  expect(await getMonthStatuses(householdId, ['2026-01', '2026-02'])).toEqual(before)
  await db.update(transactions).set({ date: '2026-02-15' }).where(and(eq(transactions.householdId, householdId), eq(transactions.id, row.id)))
  expect((await getMonthStatuses(householdId, ['2026-01', '2026-02'])).map(s => s.state)).toEqual(['needs_review', 'needs_review'])
})

test('a stale reviewed revision cannot close changed ledger data', async () => {
  const summary = await getMonthCloseSummary(householdId, '2026-01')
  await add()
  expect(await closeMonth(householdId, userId, { month: '2026-01', revision: summary.revision, acknowledgeWarnings: true, acknowledgeEmpty: true })).toMatchObject({ ok: false })
  expect((await status()).state).toBe('open')
})

test('summary counts the whole ledger and inbox warning without invalidating a closed month', async () => {
  await add(); await add('2026-01', 600)
  await close()
  await db.insert(importInbox).values({ householdId, importUid: 'pending', owner: 'DJ', date: '2026-01-16', flow: 'expense', amount: 99 })
  expect(await getMonthCloseSummary(householdId, '2026-01')).toMatchObject({ count: 2, expense: 1000, pendingCount: 1, unclassifiedCount: 2, state: 'closed' })
  await reopenMonth(householdId, '2026-01')
  const summary = await getMonthCloseSummary(householdId, '2026-01')
  expect(await closeMonth(householdId, userId, { month: '2026-01', revision: summary.revision, acknowledgeWarnings: false, acknowledgeEmpty: true })).toMatchObject({ ok: false })
})

test('concurrent close and write cannot leave the new ledger version certified', async () => {
  const row = await add()
  const summary = await getMonthCloseSummary(householdId, '2026-01')
  await Promise.all([
    closeMonth(householdId, userId, { month: '2026-01', revision: summary.revision, acknowledgeWarnings: true, acknowledgeEmpty: true }),
    db.update(transactions).set({ amount: 900 }).where(and(eq(transactions.householdId, householdId), eq(transactions.id, row.id))),
  ])
  expect((await status()).state).not.toBe('closed')
})

test('authenticated clients cannot forge revisions or closing records', async () => {
  await add()
  await expect(db.transaction(async tx => {
    await tx.execute(sql`set local role authenticated`)
    await tx.execute(sql`update public.ledger_months set closed_revision = revision, closed_at = now() where household_id = ${householdId}::uuid`)
  })).rejects.toThrow()
  expect((await status()).state).toBe('open')
})

test('bulk writes touch affected months and household cascade never resurrects them', async () => {
  await add('2026-02'); await add('2026-01')
  await close('2026-01'); await close('2026-02')
  await db.update(transactions).set({ amount: 777 }).where(eq(transactions.householdId, householdId))
  expect((await getMonthStatuses(householdId, ['2026-01', '2026-02'])).map(s => s.state)).toEqual(['needs_review', 'needs_review'])
  await db.delete(households).where(eq(households.id, householdId))
  const result = await db.execute(sql`select month from public.ledger_months where household_id = ${householdId}::uuid`)
  expect(result).toHaveLength(0)
})
