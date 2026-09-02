import { and, asc, count, desc, eq, ilike, isNull } from 'drizzle-orm'

import { db } from '@/db/client'
import {
  accountAliases,
  accounts,
  categories,
  categoryRules,
  recurring,
  transactions,
} from '@/db/schema'

export type ManageTab = 'accounts' | 'categories' | 'rules' | 'unclassified'

export async function getManageData(
  householdId: string,
  options: { tab: ManageTab; ruleQuery?: string },
) {
  const [accountRows, categoryRows, accountUsageRows, categoryUsageRows, ruleCountRows, aliasCountRows, unclassifiedCountRows] = await Promise.all([
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
    db.select({ value: count() }).from(categoryRules).where(eq(categoryRules.householdId, householdId)),
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

  const ruleFilter = options.ruleQuery?.trim()
  const ruleRows = options.tab === 'rules'
    ? await db
        .select({
          id: categoryRules.id,
          matchType: categoryRules.matchType,
          pattern: categoryRules.pattern,
          categoryId: categoryRules.categoryId,
          accountId: categoryRules.accountId,
          flow: categoryRules.flow,
          fixed: categoryRules.fixed,
          priority: categoryRules.priority,
          hits: categoryRules.hits,
          categoryMajor: categories.major,
          categorySub: categories.sub,
          accountName: accounts.name,
        })
        .from(categoryRules)
        .leftJoin(categories, and(eq(categories.id, categoryRules.categoryId), eq(categories.householdId, householdId)))
        .leftJoin(accounts, and(eq(accounts.id, categoryRules.accountId), eq(accounts.householdId, householdId)))
        .where(and(
          eq(categoryRules.householdId, householdId),
          ruleFilter ? ilike(categoryRules.pattern, `%${ruleFilter}%`) : undefined,
        ))
        .orderBy(desc(categoryRules.hits), asc(categoryRules.pattern))
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
    rules: ruleRows,
    aliases: aliasRows,
    unclassified: unclassifiedRows,
    counts: {
      accounts: accountRows.length,
      categories: categoryRows.length,
      rules: ruleCountRows[0]?.value ?? 0,
      aliases: aliasCountRows[0]?.value ?? 0,
      unclassified: unclassifiedCountRows[0]?.value ?? 0,
    },
  }
}
