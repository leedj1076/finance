import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { accounts, categories, importInbox, merchantLookup } from '@/db/schema'

import { isAggregatorNorm } from './merchant-lookup'
import { normalizeMerchant } from './normalize'

export async function getInboxData(householdId: string) {
  const [items, categoryOptions, accountOptions, statusRows] = await Promise.all([
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
    counts,
    truncated: counts.pending > items.length,
  }
}
