import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { db } from '@/db/client'
import { categories, households, importInbox, ledgerMonths, transactions } from '@/db/schema'
import { closeLedgerMonth, loadMonthCloseSummary, reopenLedgerMonth } from '@/features/month-close/actions'
import { getMonthStatuses } from '@/features/month-close/queries'
import { saveTransaction } from '@/features/ledger/actions'
import { applyInboxItem, approveHighConfidence, processInbox } from '@/features/inbox/actions'

const context = vi.hoisted(() => ({ householdId: '', userId: '', email: 'test@example.com' }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => context }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) } }))
let categoryId: number
beforeEach(async () => {
  const [household] = await db.insert(households).values({ name: 'TEST-closing-actions' }).returning()
  context.householdId = household.id; context.userId = randomUUID()
  const [category] = await db.insert(categories).values({ householdId: household.id, kind: 'expense', major: '식비', sub: '식사' }).returning()
  categoryId = category.id
})
afterEach(async () => { await db.delete(households).where(eq(households.id, context.householdId)) })
async function close(month = '2026-01') {
  const summary = await loadMonthCloseSummary(month)
  if (!summary.summary) throw new Error(summary.error)
  expect(await closeLedgerMonth({ month, revision: summary.summary.revision, acknowledgeWarnings: true, acknowledgeEmpty: true })).toMatchObject({ ok: true })
}
function form(values: Record<string, string>) {
  const data = new FormData(); Object.entries(values).forEach(([key, value]) => data.set(key, value)); return data
}
async function status(month = '2026-01') { return (await getMonthStatuses(context.householdId, [month]))[0] }
async function inbox(uid: string, confidence = 'review') {
  const [row] = await db.insert(importInbox).values({ householdId: context.householdId, importUid: uid, date: '2026-01-15', flow: 'expense', amount: 300, owner: 'DJ', categoryId, confidence }).returning()
  return row
}

test('authenticated actions record the server user and return refreshed whole-month summary', async () => {
  await close()
  const [row] = await db.select().from(ledgerMonths).where(and(eq(ledgerMonths.householdId, context.householdId), eq(ledgerMonths.month, '2026-01')))
  expect(row.closedBy).toBe(context.userId)
  expect(await reopenLedgerMonth('2026-01')).toMatchObject({ ok: true })
  expect((await status()).state).toBe('needs_review')
})

test('inline manual edit reports both invalidated months; no-op save does not report a reopen', async () => {
  const [row] = await db.insert(transactions).values({ householdId: context.householdId, date: '2026-01-15', flow: 'expense', amount: 400, categoryId, memo: '식사' }).returning()
  await close(); await close('2026-02')
  const fields = { transactionId: String(row.id), date: '2026-01-15', flow: 'expense', amount: '400', categoryId: String(categoryId), memo: '식사', inline: '1' }
  expect((await saveTransaction({}, form(fields))).message ?? '').not.toContain('마감이 해제')
  expect((await status()).state).toBe('closed')
  const saved = await saveTransaction({}, form({ ...fields, date: '2026-02-15' }))
  expect(saved.saved?.date).toBe('2026-02-15')
  expect(saved.message).toContain('2026-01')
  expect(saved.message).toContain('2026-02')
  expect(saved.message).toContain('마감이 해제')
})

test('inbox single, selected and high-confidence application report reopening; exclusion and duplicate skip retain close', async () => {
  await close()
  const a = await inbox('single')
  const single = await applyInboxItem({ id: a.id, flow: 'expense', categoryId, accountId: null })
  expect(single.message).toContain('마감이 해제')
  await close()
  const b = await inbox('bulk')
  const selected = await processInbox(form({ ids: String(b.id), inline: '1', [`flow_${b.id}`]: 'expense', [`category_${b.id}`]: String(categoryId) }))
  expect(selected?.message).toContain('마감이 해제')
  await close()
  await inbox('high', 'high')
  expect((await approveHighConfidence()).message).toContain('마감이 해제')
  await close()
  const dismissed = await inbox('dismiss')
  await processInbox(form({ ids: String(dismissed.id), inline: '1', intent: 'dismiss' }))
  expect((await status()).state).toBe('closed')
  await db.update(importInbox).set({ status: 'pending' }).where(and(eq(importInbox.householdId, context.householdId), eq(importInbox.id, a.id)))
  const duplicate = await applyInboxItem({ id: a.id, flow: 'expense', categoryId, accountId: null })
  expect(duplicate.message).not.toContain('마감이 해제')
  expect((await status()).state).toBe('closed')
})
