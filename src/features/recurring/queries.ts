import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { accounts, categories, recurring, transactions } from '@/db/schema'
import { currentMonthInKorea, isMonthKey, monthBounds, shiftMonth } from '@/lib/finance'

import { detectRecurringCandidates } from './calculations'
import { flowToToken } from './recurring-input'

export async function getRecurringData(householdId: string, requestedMonth?: string) {
  const month = isMonthKey(requestedMonth) ? requestedMonth : currentMonthInKorea()
  const { start, end } = monthBounds(month)
  const historyStart = `${shiftMonth(month, -17)}-01`

  const [ruleRows, accountRows, categoryRows, generatedRows, historyRows] = await Promise.all([
    db
      .select({
        id: recurring.id,
        flow: recurring.flow,
        fixed: recurring.fixed,
        categoryId: recurring.categoryId,
        major: categories.major,
        sub: categories.sub,
        memo: recurring.memo,
        amount: recurring.amount,
        accountId: recurring.accountId,
        accountName: accounts.name,
        day: recurring.day,
        active: recurring.active,
        sortOrder: recurring.sortOrder,
      })
      .from(recurring)
      .leftJoin(
        categories,
        and(eq(categories.id, recurring.categoryId), eq(categories.householdId, householdId)),
      )
      .leftJoin(
        accounts,
        and(eq(accounts.id, recurring.accountId), eq(accounts.householdId, householdId)),
      )
      .where(eq(recurring.householdId, householdId))
      .orderBy(recurring.sortOrder, recurring.id),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.active, true)))
      .orderBy(accounts.sortOrder, accounts.name),
    db
      .select({ id: categories.id, kind: categories.kind, major: categories.major, sub: categories.sub })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.hidden, false)))
      .orderBy(categories.kind, categories.sortOrder, categories.major, categories.sub),
    db
      .select({ recurringId: transactions.recurringId })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.date, start),
          lt(transactions.date, end),
          sql`${transactions.recurringId} is not null`,
        ),
      ),
    db
      .select({
        date: transactions.date,
        amount: transactions.amount,
        merchant: sql<string>`coalesce(nullif(${transactions.rawMerchant}, ''), nullif(${transactions.memo}, ''), '')`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.flow, 'expense'),
          gte(transactions.date, historyStart),
          lt(transactions.date, end),
        ),
      )
      .orderBy(desc(transactions.date)),
  ])

  const generatedIds = new Set(generatedRows.flatMap((row) => row.recurringId === null ? [] : [row.recurringId]))
  const rules = ruleRows.map((row) => ({
    ...row,
    memo: row.memo ?? '',
    flowToken: flowToToken(row.flow, row.fixed),
    generated: generatedIds.has(row.id),
  }))
  const activeRules = rules.filter((rule) => rule.active)
  const totals = {
    expense: activeRules.filter((rule) => rule.flow === 'expense').reduce((sum, rule) => sum + rule.amount, 0),
    income: activeRules.filter((rule) => rule.flow === 'income').reduce((sum, rule) => sum + rule.amount, 0),
    saving: activeRules.filter((rule) => rule.flow === 'saving').reduce((sum, rule) => sum + rule.amount, 0),
  }
  const candidates = detectRecurringCandidates(
    historyRows
      .filter((row) => row.merchant)
      .map((row) => ({ ...row, amount: Number(row.amount) })),
    rules.map((rule) => rule.memo),
  )

  return {
    month,
    rules,
    accounts: accountRows,
    categories: categoryRows,
    candidates,
    activeCount: activeRules.length,
    generatedCount: activeRules.filter((rule) => rule.generated).length,
    totals,
  }
}
