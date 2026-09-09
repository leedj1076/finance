import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { categories, importInbox, ledgerMonths, recurring, transactions } from '@/db/schema'
import { recurringIsDue } from '@/features/recurring/calculations'
import { recurringPostingInMonth } from '@/features/recurring/posting-identity'
import { monthBounds } from '@/lib/finance'
import { canCloseMonth, toMonthStatus, validLedgerMonth, type MonthCloseSummary } from './state'

export type MonthReader = Pick<typeof db, 'select'>

export async function readMonthStatuses(reader: MonthReader, householdId: string, months: string[]) {
  const keys = [...new Set(months)].filter(validLedgerMonth)
  if (!keys.length) return []
  const rows = await reader.select().from(ledgerMonths).where(and(eq(ledgerMonths.householdId, householdId), inArray(ledgerMonths.month, keys)))
  const byMonth = new Map(rows.map(row => [row.month, row]))
  return keys.map(month => toMonthStatus(month, byMonth.get(month)))
}

export function getMonthStatuses(householdId: string, months: string[]) {
  return readMonthStatuses(db, householdId, months)
}

/** Caller controls the snapshot; reused under the close transaction's month lock. */
export async function readMonthCloseSummary(reader: MonthReader, householdId: string, month: string): Promise<MonthCloseSummary> {
  if (!validLedgerMonth(month)) throw new Error('올바른 월을 선택해 주세요.')
  const { start, end } = monthBounds(month)
  const [status] = await readMonthStatuses(reader, householdId, [month])
  const [totals] = await reader.select({
    count: sql<number>`count(*)::int`,
    income: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.flow} = 'income'), 0)::bigint`.mapWith(Number),
    expense: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.flow} = 'expense'), 0)::bigint`.mapWith(Number),
    saving: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.flow} = 'saving'), 0)::bigint`.mapWith(Number),
    unclassifiedCount: sql<number>`count(*) filter (where ${categories.id} is null or ${categories.major} = '미분류')::int`,
  }).from(transactions).leftJoin(categories, and(eq(categories.householdId, householdId), eq(categories.id, transactions.categoryId)))
    .where(and(eq(transactions.householdId, householdId), gte(transactions.date, start), lt(transactions.date, end)))
  const [pending] = await reader.select({ count: sql<number>`count(*)::int` }).from(importInbox)
    .where(and(eq(importInbox.householdId, householdId), eq(importInbox.status, 'pending'), gte(importInbox.date, start), lt(importInbox.date, end)))
  const rules = await reader.select({ id: recurring.id, active: recurring.active, startMonth: recurring.startMonth, endMonth: recurring.endMonth })
    .from(recurring).where(eq(recurring.householdId, householdId))
  const postings = await reader.select({ recurringId: transactions.recurringId }).from(transactions)
    .where(and(eq(transactions.householdId, householdId), recurringPostingInMonth(month)))
  const postedIds = new Set(postings.map(row => row.recurringId))
  const unpostedRecurringCount = rules.filter(rule => recurringIsDue(rule, month) && !postedIds.has(rule.id)).length
  return {
    ...status, ...totals, pendingCount: pending.count, unpostedRecurringCount,
    closable: canCloseMonth(month),
    requiresAcknowledgment: pending.count + totals.unclassifiedCount + unpostedRecurringCount > 0,
  }
}

export function getMonthCloseSummary(householdId: string, month: string) {
  return db.transaction(tx => readMonthCloseSummary(tx, householdId, month), { isolationLevel: 'repeatable read', accessMode: 'read only' })
}
