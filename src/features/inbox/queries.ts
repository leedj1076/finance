import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { accounts, categories, importInbox, merchantLookup, transactions } from '@/db/schema'

import { isAggregatorNorm } from './merchant-lookup'
import { normalizeMerchant } from './normalize'
import { cardSourceFromMarker } from './parsers/cards'

function inboxSource(row: { bsCat1: string | null; owner: string }) {
  return cardSourceFromMarker(row.bsCat1) ?? `banksalad:${row.owner.toLowerCase()}`
}

function sourceLabel(source: string) {
  if (source.startsWith('card:')) return `${source.slice(5).toUpperCase()} 카드 명세서`
  if (source === 'banksalad:dj') return 'DJ 뱅크샐러드'
  if (source === 'banksalad:yj') return 'YJ 뱅크샐러드'
  return source
}

export function buildInboxProcessingHistory(rows: Array<{
  owner: string
  bsCat1: string | null
  status: 'pending' | 'done' | 'dismissed'
  date: string
  createdAt: Date
}>) {
  const historyMap = new Map<string, {
    source: string
    label: string
    processedOn: string
    done: number
    dismissed: number
    earliestMonth: string
    latestMonth: string
  }>()
  for (const row of rows) {
    if (row.status === 'pending') continue
    const source = inboxSource(row)
    const processedOn = row.createdAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
    const key = `${source}|${processedOn}`
    const month = row.date.slice(0, 7)
    const entry = historyMap.get(key) ?? {
      source,
      label: sourceLabel(source),
      processedOn,
      done: 0,
      dismissed: 0,
      earliestMonth: month,
      latestMonth: month,
    }
    if (row.status === 'done') entry.done += 1
    else entry.dismissed += 1
    if (month < entry.earliestMonth) entry.earliestMonth = month
    if (month > entry.latestMonth) entry.latestMonth = month
    historyMap.set(key, entry)
  }
  return [...historyMap.values()].sort((left, right) =>
    right.processedOn.localeCompare(left.processedOn) || left.label.localeCompare(right.label, 'ko'),
  )
}

export async function getInboxData(householdId: string) {
  const [items, categoryOptions, accountOptions, statusRows, unclassifiedRows, historyRows] = await Promise.all([
    db
      .select({
        id: importInbox.id,
        owner: importInbox.owner,
        date: importInbox.date,
        merchant: importInbox.merchant,
        amount: importInbox.amount,
        flow: importInbox.flow,
        kind: importInbox.kind,
        bsCat1: importInbox.bsCat1,
        bsCat2: importInbox.bsCat2,
        pay: importInbox.pay,
        accountId: importInbox.accountId,
        categoryId: importInbox.categoryId,
        memo: importInbox.memo,
        sugSource: importInbox.sugSource,
        dupNote: importInbox.dupNote,
        confidence: importInbox.confidence,
        categoryMajor: categories.major,
        categorySub: categories.sub,
      })
      .from(importInbox)
      .leftJoin(
        categories,
        and(
          eq(categories.id, importInbox.categoryId),
          eq(categories.householdId, householdId),
        ),
      )
      .where(
        and(
          eq(importInbox.householdId, householdId),
          eq(importInbox.status, 'pending'),
        ),
      )
      .orderBy(desc(importInbox.date), desc(importInbox.id))
      .limit(500),
    db
      .select({
        id: categories.id,
        kind: categories.kind,
        major: categories.major,
        sub: categories.sub,
      })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.hidden, false)))
      .orderBy(categories.kind, categories.sortOrder, categories.major, categories.sub),
    db
      .select({ id: accounts.id, name: accounts.name, owner: accounts.owner, type: accounts.type })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.active, true)))
      .orderBy(accounts.sortOrder, asc(accounts.name)),
    db
      .select({ status: importInbox.status, count: sql<string>`count(*)` })
      .from(importInbox)
      .where(eq(importInbox.householdId, householdId))
      .groupBy(importInbox.status),
    db
      .select({ count: sql<string>`count(*)` })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), isNull(transactions.categoryId))),
    db
      .select({
        id: importInbox.id,
        owner: importInbox.owner,
        bsCat1: importInbox.bsCat1,
        status: importInbox.status,
        date: importInbox.date,
        createdAt: importInbox.createdAt,
      })
      .from(importInbox)
      .where(
        and(
          eq(importInbox.householdId, householdId),
          ne(importInbox.status, 'pending'),
        ),
      )
      .orderBy(desc(importInbox.createdAt), desc(importInbox.id))
      .limit(2_000),
  ])

  const counts = { pending: 0, done: 0, dismissed: 0 }
  for (const row of statusRows) counts[row.status] = Number(row.count)

  const lookupNorms = [
    ...new Set(
      items
        .map((item) => normalizeMerchant(item.merchant)),
    ),
  ].filter(Boolean)
  const lookupRows = lookupNorms.length > 0
    ? await db
        .select({
          normMerchant: merchantLookup.normMerchant,
          businessType: merchantLookup.businessType,
          aiNote: merchantLookup.aiNote,
          alwaysConfirm: merchantLookup.alwaysConfirm,
        })
        .from(merchantLookup)
        .where(
          and(
            eq(merchantLookup.householdId, householdId),
            inArray(merchantLookup.normMerchant, lookupNorms),
          ),
        )
    : []
  const lookupByNorm = new Map(lookupRows.map((row) => [row.normMerchant, row]))
  const enrichedItems = items.map((item) => {
    const normMerchant = normalizeMerchant(item.merchant)
    const lookup = lookupByNorm.get(normMerchant)
    return {
      ...item,
      businessType: lookup?.businessType ?? null,
      aiNote: lookup?.aiNote ?? null,
      alwaysConfirm: lookup?.alwaysConfirm ?? isAggregatorNorm(normMerchant),
      categoryLabel: item.categoryMajor && item.categorySub
        ? `${item.categoryMajor} · ${item.categorySub}`
        : null,
    }
  })
  return {
    items: enrichedItems,
    highItems: enrichedItems.filter((item) => item.confidence === 'high'),
    reviewItems: enrichedItems.filter((item) => item.confidence !== 'high'),
    categories: categoryOptions,
    accounts: accountOptions,
    counts: { ...counts, unclassified: Number(unclassifiedRows[0]?.count ?? 0) },
    history: buildInboxProcessingHistory(historyRows),
    truncated: counts.pending > items.length,
  }
}
