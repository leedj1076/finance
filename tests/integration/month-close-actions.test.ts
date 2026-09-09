import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { db } from '@/db/client'
import { categories, households, importInbox, ledgerMonths, recurring, transactions } from '@/db/schema'
import { closeLedgerMonth, loadMonthCloseSummary, reopenLedgerMonth } from '@/features/month-close/actions'
import { getMonthStatuses } from '@/features/month-close/queries'
import { deleteTransaction, saveTransaction } from '@/features/ledger/actions'
import { applyInboxItem, approveHighConfidence, processInbox } from '@/features/inbox/actions'
import { restoreInboxItems } from '@/features/inbox/history-actions'
import { bulkClassifyTransactions, classifyTransaction } from '@/features/manage/actions'
import { applyRecurringMonth } from '@/features/recurring/actions'
import { GET as cellTransactions } from '@/app/api/cell-tx/route'
import { NextRequest } from 'next/server'

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

async function expectRedirectNotice(action: Promise<unknown>, notice: string) {
  const error = await action.catch(error => error)
  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw new Error('Expected a redirect')
  expect(error.message).toMatch(/^REDIRECT:/)
  const url = new URL(error.message.replace('REDIRECT:', ''), 'http://localhost')
  expect(url.searchParams.get('notice')).toContain(notice)
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
  await restoreInboxItems([dismissed.id])
  expect((await status()).state).toBe('closed')
  await db.update(importInbox).set({ status: 'pending' }).where(and(eq(importInbox.householdId, context.householdId), eq(importInbox.id, a.id)))
  const duplicate = await applyInboxItem({ id: a.id, flow: 'expense', categoryId, accountId: null })
  expect(duplicate.message).not.toContain('마감이 해제')
  expect((await status()).state).toBe('closed')
})

test('manual creation and deletion reopen the actual transaction month', async () => {
  await close()
  await expectRedirectNotice(saveTransaction({}, form({ date: '2026-01-15', flow: 'expense', amount: '600', memo: 'manual', categoryId: String(categoryId) })), '마감이 해제')
  expect((await status()).state).toBe('needs_review')
  await close()
  const [row] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.householdId, context.householdId))
  await expectRedirectNotice(deleteTransaction(form({ transactionId: String(row.id), month: '2026-01' })), '마감이 해제')
  expect((await status()).state).toBe('needs_review')
})

test('single and bulk unclassified actions invalidate a close and retain their existing response contracts', async () => {
  const rows = await db.insert(transactions).values([1, 2].map(day => ({ householdId: context.householdId, date: `2026-01-0${day}`, flow: 'expense' as const, amount: 400 }))).returning()
  await close()
  await expect(classifyTransaction(form({ id: String(rows[0].id), categoryId: String(categoryId) }))).rejects.toThrow(encodeURIComponent('마감이 해제'))
  expect((await status()).state).toBe('needs_review')
  await close()
  await expect(bulkClassifyTransactions(form({ ids: String(rows[1].id), [`category_${rows[1].id}`]: String(categoryId), [`flow_${rows[1].id}`]: 'exp_var' }))).rejects.toThrow(encodeURIComponent('마감이 해제'))
  expect((await status()).state).toBe('needs_review')
})

test('business-day recurring application invalidates the adjusted date month, not merely the requested posting month', async () => {
  await db.insert(recurring).values({ householdId: context.householdId, flow: 'expense', memo: 'First day', amount: 600, day: 1, startMonth: '2026-03', endMonth: '2026-03', adjustToBusinessDay: true, categoryId })
  await close('2026-02'); await close('2026-03')
  await expectRedirectNotice(applyRecurringMonth(form({ month: '2026-03' })), '2026-02 마감이 해제')
  const [posted] = await db.select().from(transactions).where(eq(transactions.householdId, context.householdId))
  expect(posted.date).toBe('2026-02-27')
  expect(posted.importUid).toContain(':2026-03')
  expect((await status('2026-02')).state).toBe('needs_review')
  expect((await status('2026-03')).state).toBe('closed')
  await close('2026-02')
  await expect(applyRecurringMonth(form({ month: '2026-03' }))).rejects.toThrow('recurringAdded=0&recurringSkipped=1')
  expect((await status('2026-02')).state).toBe('closed')
})

test('closed cell HTTP requests fail explicitly when stale or malformed; household and user fields from input are ignored', async () => {
  const [foreign] = await db.insert(households).values({ name: 'TEST-other-close' }).returning()
  try {
    const input = { householdId: foreign.id, userId: randomUUID(), month: '2026-01', revision: 0, acknowledgeWarnings: true, acknowledgeEmpty: true }
    expect(await closeLedgerMonth(input)).toEqual({ ok: true })
    expect((await getMonthStatuses(foreign.id, ['2026-01']))[0].state).toBe('open')
    const base = 'http://localhost/api/cell-tx?year=2026&month=1&flow=expense&major=식비&sub=카페&scope=closed'
    expect((await cellTransactions(new NextRequest(`${base}&revision=0`))).status).toBe(200)
    expect((await cellTransactions(new NextRequest(base))).status).toBe(400)
    await reopenLedgerMonth('2026-01')
    const stale = await cellTransactions(new NextRequest(`${base}&revision=0`))
    expect(stale.status).toBe(409)
    const body = await stale.json()
    expect(body.refresh).toBe(true)
    expect(body).not.toHaveProperty('total')
    expect(body).not.toHaveProperty('items')
  } finally { await db.delete(households).where(eq(households.id, foreign.id)) }
})
