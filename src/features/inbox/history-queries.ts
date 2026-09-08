import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { accounts, categories, importInbox, transactions } from '@/db/schema'

import type { InboxHistoryEntry, InboxHistoryPage, InboxHistoryRequest } from './history-types'
import { CARD_ISSUERS } from './parsers/cards'

const source = sql<string>`case when ${inArray(importInbox.bsCat1, CARD_ISSUERS.map((card) => `__source:card:${card.key}`))}
  then replace(${importInbox.bsCat1}, '__source:', '')
  else 'banksalad:' || lower(${importInbox.owner}) end`
const uploadedOn = sql<string>`to_char(${importInbox.createdAt} at time zone 'Asia/Seoul', 'YYYY-MM-DD')`

function sourceLabel(value: string) {
  if (value.startsWith('card:')) return `${value.slice(5).toUpperCase()} 카드 명세서`
  if (value === 'banksalad:dj') return 'DJ 뱅크샐러드'
  if (value === 'banksalad:yj') return 'YJ 뱅크샐러드'
  return value
}

/** Aggregate before reading rows: a large upload must not silently lose history. */
export async function getInboxHistory(householdId: string): Promise<InboxHistoryEntry[]> {
  const historySource = source.as('history_source')
  const historyDay = uploadedOn.as('history_uploaded_on')
  const rows = await db.select({
    source: historySource, processedOn: historyDay,
    pending: sql<number>`count(*) filter (where ${importInbox.status} = 'pending')`.mapWith(Number),
    done: sql<number>`count(*) filter (where ${importInbox.status} = 'done')`.mapWith(Number),
    dismissed: sql<number>`count(*) filter (where ${importInbox.status} = 'dismissed')`.mapWith(Number),
    earliestMonth: sql<string>`min(left(${importInbox.date}, 7))`,
    latestMonth: sql<string>`max(left(${importInbox.date}, 7))`,
  }).from(importInbox).where(eq(importInbox.householdId, householdId))
    .groupBy(historySource, historyDay).orderBy(desc(historyDay), asc(historySource))
  return rows.map((row) => ({ ...row, label: sourceLabel(row.source) }))
}

export async function getInboxHistoryItems(householdId: string, request: InboxHistoryRequest): Promise<InboxHistoryPage> {
  const pageSize = 50
  const where = and(
    eq(importInbox.householdId, householdId),
    eq(source, request.source), eq(uploadedOn, request.processedOn),
    request.status === 'all' ? undefined : eq(importInbox.status, request.status),
  )
  const [totals] = await db.select({ total: count() }).from(importInbox).where(where)
  const total = totals.total
  const page = Math.max(1, Math.min(request.page, Math.ceil(total / pageSize) || 1))
  const effectiveCategory = sql<number>`case when ${transactions.id} is not null then ${transactions.categoryId} else ${importInbox.categoryId} end`
  const effectiveAccount = sql<number>`case when ${transactions.id} is not null then ${transactions.accountId} else ${importInbox.accountId} end`
  const items = await db.select({
    id: importInbox.id, owner: importInbox.owner, date: importInbox.date,
    merchant: importInbox.merchant, amount: importInbox.amount,
    flow: sql<'expense' | 'income' | 'saving'>`coalesce(${transactions.flow}, ${importInbox.flow})`,
    status: importInbox.status,
    accountName: sql<string | null>`coalesce(${accounts.name}, ${importInbox.pay})`,
    categoryMajor: categories.major, categorySub: categories.sub, dupNote: importInbox.dupNote,
    canRestore: sql<boolean>`${importInbox.status} = 'dismissed' and ${transactions.id} is null`,
  }).from(importInbox)
    .leftJoin(transactions, and(eq(transactions.householdId, householdId), eq(transactions.importUid, importInbox.importUid)))
    .leftJoin(categories, and(eq(categories.householdId, householdId), eq(categories.id, effectiveCategory)))
    .leftJoin(accounts, and(eq(accounts.householdId, householdId), eq(accounts.id, effectiveAccount)))
    .where(where).orderBy(desc(importInbox.date), desc(importInbox.id))
    .limit(pageSize).offset((page - 1) * pageSize)
  return { items, total, page, pageSize }
}
