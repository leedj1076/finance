import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm'

import { db } from '@/db/client'
import {
  accountAliases,
  accounts,
  categories,
  merchantLookup,
  recurring,
  transactions,
} from '@/db/schema'
import {
  buildHistorySuggester,
  type TransactionFlow,
} from '@/features/inbox/banksalad'
import { normalizeMerchant } from '@/features/inbox/normalize'

export type ManageTab = 'accounts' | 'categories' | 'rules' | 'unclassified'

export async function getManageData(
  householdId: string,
  options: { tab: ManageTab; ruleQuery?: string },
) {
  const [accountRows, categoryRows, accountUsageRows, categoryUsageRows, dictionaryCountRows, aliasCountRows, unclassifiedCountRows] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(eq(accounts.householdId, householdId))
      .orderBy(accounts.sortOrder, accounts.name),
    db
      .select()
      .from(categories)
      .where(eq(categories.householdId, householdId))
      .orderBy(categories.kind, categories.sortOrder, categories.major, categories.sub),
    db
      .select({ id: transactions.accountId, value: count() })
      .from(transactions)
      .where(eq(transactions.householdId, householdId))
      .groupBy(transactions.accountId),
    db
      .select({ id: transactions.categoryId, value: count() })
      .from(transactions)
      .where(eq(transactions.householdId, householdId))
      .groupBy(transactions.categoryId),
    db.select({ value: count() }).from(merchantLookup).where(eq(merchantLookup.householdId, householdId)),
    db.select({ value: count() }).from(accountAliases).where(eq(accountAliases.householdId, householdId)),
    db
      .select({ value: count() })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), isNull(transactions.categoryId))),
  ])

  const accountUsage = new Map(accountUsageRows.map((row) => [row.id, row.value]))
  const categoryUsage = new Map(categoryUsageRows.map((row) => [row.id, row.value]))
  const accountData = accountRows.map((row) => ({ ...row, transactionCount: accountUsage.get(row.id) ?? 0 }))
  const categoryData = categoryRows.map((row) => ({ ...row, transactionCount: categoryUsage.get(row.id) ?? 0 }))

  const dictionaryFilter = options.ruleQuery?.trim()
  const dictionaryRows = options.tab === 'rules'
    ? await db
        .select({
          id: merchantLookup.id,
          normMerchant: merchantLookup.normMerchant,
          displayMerchant: merchantLookup.displayMerchant,
          businessType: merchantLookup.businessType,
          categoryId: merchantLookup.categoryId,
          flow: merchantLookup.flow,
          source: merchantLookup.source,
          confidence: merchantLookup.confidence,
          aiNote: merchantLookup.aiNote,
          alwaysConfirm: merchantLookup.alwaysConfirm,
          hitCount: merchantLookup.hitCount,
          lastUsedAt: merchantLookup.lastUsedAt,
          categoryMajor: categories.major,
          categorySub: categories.sub,
        })
        .from(merchantLookup)
        .leftJoin(
          categories,
          and(
            eq(categories.id, merchantLookup.categoryId),
            eq(categories.householdId, householdId),
          ),
        )
        .where(and(
          eq(merchantLookup.householdId, householdId),
          dictionaryFilter
            ? or(
                ilike(merchantLookup.normMerchant, `%${dictionaryFilter}%`),
                ilike(merchantLookup.displayMerchant, `%${dictionaryFilter}%`),
                ilike(merchantLookup.businessType, `%${dictionaryFilter}%`),
              )
            : undefined,
        ))
        .orderBy(desc(merchantLookup.hitCount), asc(merchantLookup.normMerchant))
        .limit(100)
    : []

  const aliasRows = options.tab === 'rules'
    ? await db
        .select({
          owner: accountAliases.owner,
          alias: accountAliases.alias,
          accountId: accountAliases.accountId,
          accountName: accounts.name,
        })
        .from(accountAliases)
        .leftJoin(accounts, and(eq(accounts.id, accountAliases.accountId), eq(accounts.householdId, householdId)))
        .where(eq(accountAliases.householdId, householdId))
        .orderBy(accountAliases.owner, accountAliases.alias)
    : []

  const unclassifiedRows = options.tab === 'unclassified'
    ? await db
        .select({
          id: transactions.id,
          date: transactions.date,
          flow: transactions.flow,
          fixed: transactions.fixed,
          memo: transactions.memo,
          rawMerchant: transactions.rawMerchant,
          amount: transactions.amount,
          accountName: accounts.name,
        })
        .from(transactions)
        .leftJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.householdId, householdId)))
        .where(and(eq(transactions.householdId, householdId), isNull(transactions.categoryId)))
        .orderBy(desc(transactions.date), desc(transactions.id))
        .limit(100)
    : []

  const [suggestionLookupRows, suggestionHistoryRows] = options.tab === 'unclassified'
    ? await Promise.all([
        db
          .select({
            normMerchant: merchantLookup.normMerchant,
            flow: merchantLookup.flow,
            source: merchantLookup.source,
            categoryId: categories.id,
            categoryKind: categories.kind,
          })
          .from(merchantLookup)
          .innerJoin(
            categories,
            and(
              eq(categories.id, merchantLookup.categoryId),
              eq(categories.householdId, householdId),
              eq(categories.hidden, false),
            ),
          )
          .where(eq(merchantLookup.householdId, householdId)),
        db
          .select({
            flow: transactions.flow,
            fixed: transactions.fixed,
            major: categories.major,
            sub: categories.sub,
            rawMerchant: transactions.rawMerchant,
            memo: transactions.memo,
            date: transactions.date,
          })
          .from(transactions)
          .innerJoin(
            categories,
            and(
              eq(categories.id, transactions.categoryId),
              eq(categories.householdId, householdId),
              eq(categories.hidden, false),
            ),
          )
          .where(eq(transactions.householdId, householdId)),
      ])
    : [[], []]

  const activeCategories = categoryRows.filter((category) => !category.hidden)
  const activeCategoryByTaxonomy = new Map(
    activeCategories.map((category) => [
      `${category.kind}|${category.major}|${category.sub}`,
      category,
    ]),
  )
  const lookupByNorm = new Map<
    string,
    { flow: TransactionFlow; source: 'user' | 'ai'; categoryId: number }
  >()
  for (const entry of suggestionLookupRows) {
    if (entry.flow !== entry.categoryKind) continue
    if (entry.source !== 'user' && entry.source !== 'ai') continue
    lookupByNorm.set(entry.normMerchant, {
      flow: entry.flow,
      source: entry.source,
      categoryId: entry.categoryId,
    })
  }
  const suggestFromHistory = buildHistorySuggester(
    suggestionHistoryRows
      .map((row) => ({
        flow: row.flow,
        fixed: row.fixed,
        major: row.major,
        sub: row.sub,
        merchant: row.rawMerchant || row.memo || '',
        date: row.date,
      }))
      .filter((row) => row.merchant),
  )
  const unclassifiedData = unclassifiedRows.map((row) => {
    const merchant = row.rawMerchant || row.memo || ''
    const cached = lookupByNorm.get(normalizeMerchant(merchant))
    if (cached?.source === 'user') {
      return {
        ...row,
        suggestedFlow: cached.flow,
        suggestedFixed: row.fixed,
        suggestedCategoryId: cached.categoryId,
        suggestionSource: 'user' as const,
      }
    }

    const history = suggestFromHistory(merchant)
    const historicalCategory = history
      ? activeCategoryByTaxonomy.get(
          `${history.flow}|${history.major}|${history.sub}`,
        )
      : null
    if (history && historicalCategory) {
      return {
        ...row,
        suggestedFlow: history.flow,
        suggestedFixed: history.fixed,
        suggestedCategoryId: historicalCategory.id,
        suggestionSource: 'history' as const,
      }
    }

    if (cached?.source === 'ai') {
      return {
        ...row,
        suggestedFlow: cached.flow,
        suggestedFixed: row.fixed,
        suggestedCategoryId: cached.categoryId,
        suggestionSource: 'ai' as const,
      }
    }

    return {
      ...row,
      suggestedFlow: row.flow,
      suggestedFixed: row.fixed,
      suggestedCategoryId: null,
      suggestionSource: null,
    }
  })

  const [recurringCountRows] = options.tab === 'categories'
    ? await Promise.all([
        db
          .select({ id: recurring.categoryId, value: count() })
          .from(recurring)
          .where(eq(recurring.householdId, householdId))
          .groupBy(recurring.categoryId),
      ])
    : [[]]
  const recurringUsage = new Map(recurringCountRows.map((row) => [row.id, row.value]))

  return {
    accounts: accountData,
    categories: categoryData.map((row) => ({ ...row, recurringCount: recurringUsage.get(row.id) ?? 0 })),
    dictionary: dictionaryRows,
    aliases: aliasRows,
    unclassified: unclassifiedData,
    counts: {
      accounts: accountRows.length,
      categories: categoryRows.length,
      rules: dictionaryCountRows[0]?.value ?? 0,
      aliases: aliasCountRows[0]?.value ?? 0,
      unclassified: unclassifiedCountRows[0]?.value ?? 0,
    },
  }
}
