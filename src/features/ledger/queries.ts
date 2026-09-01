import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { accounts, categories, transactions } from '@/db/schema'
import {
  currentMonthInKorea,
  isMonthKey,
  monthBounds,
  savingsRate,
  shiftMonth,
} from '@/lib/finance'

type Totals = {
  income: number
  expense: number
  saving: number
}

async function totalsForMonth(householdId: string, month: string): Promise<Totals> {
  const { start, end } = monthBounds(month)
  const [row] = await db
    .select({
      income: sql<string>`coalesce(sum(case when ${transactions.flow} = 'income' then ${transactions.amount} else 0 end), 0)`,
      expense: sql<string>`coalesce(sum(case when ${transactions.flow} = 'expense' then ${transactions.amount} else 0 end), 0)`,
      saving: sql<string>`coalesce(sum(case when ${transactions.flow} = 'saving' then ${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        gte(transactions.date, start),
        lt(transactions.date, end),
      ),
    )

  return {
    income: Number(row.income),
    expense: Number(row.expense),
    saving: Number(row.saving),
  }
}

export async function getLedgerData(householdId: string, requestedMonth?: string) {
  const [latest] = await db
    .select({ date: transactions.date })
    .from(transactions)
    .where(eq(transactions.householdId, householdId))
    .orderBy(desc(transactions.date))
    .limit(1)

  const latestMonth = latest?.date.slice(0, 7) ?? currentMonthInKorea()
  const month = isMonthKey(requestedMonth) ? requestedMonth : latestMonth
  const previousMonth = shiftMonth(month, -1)
  const nextMonth = shiftMonth(month, 1)
  const { start, end } = monthBounds(month)

  const [totals, previousTotals, availableMonths, rows, categoryRows] = await Promise.all([
    totalsForMonth(householdId, month),
    totalsForMonth(householdId, previousMonth),
    db
      .select({
        month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
        count: sql<string>`count(*)`,
      })
      .from(transactions)
      .where(eq(transactions.householdId, householdId))
      .groupBy(sql`to_char(${transactions.date}, 'YYYY-MM')`)
      .orderBy(desc(sql`to_char(${transactions.date}, 'YYYY-MM')`)),
    db
      .select({
        id: transactions.id,
        date: transactions.date,
        flow: transactions.flow,
        fixed: transactions.fixed,
        major: categories.major,
        sub: categories.sub,
        memo: transactions.memo,
        rawMerchant: transactions.rawMerchant,
        amount: transactions.amount,
        account: accounts.name,
      })
      .from(transactions)
      .leftJoin(
        categories,
        and(
          eq(categories.id, transactions.categoryId),
          eq(categories.householdId, householdId),
        ),
      )
      .leftJoin(
        accounts,
        and(eq(accounts.id, transactions.accountId), eq(accounts.householdId, householdId)),
      )
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.date, start),
          lt(transactions.date, end),
        ),
      )
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(500),
    db
      .select({
        major: sql<string>`coalesce(${categories.major}, '미분류')`,
        amount: sql<string>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .leftJoin(
        categories,
        and(
          eq(categories.id, transactions.categoryId),
          eq(categories.householdId, householdId),
        ),
      )
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.flow, 'expense'),
          gte(transactions.date, start),
          lt(transactions.date, end),
        ),
      )
      .groupBy(sql`coalesce(${categories.major}, '미분류')`)
      .orderBy(desc(sql`sum(${transactions.amount})`)),
  ])

  const expenseDelta = totals.expense - previousTotals.expense

  return {
    month,
    previousMonth,
    nextMonth,
    latestMonth,
    totals: {
      ...totals,
      netSaving: totals.income - totals.expense,
      savingsRate: savingsRate(totals.income, totals.expense),
    },
    comparison: {
      previousExpense: previousTotals.expense,
      expenseDelta,
      expenseDeltaRate:
        previousTotals.expense > 0 ? (expenseDelta / previousTotals.expense) * 100 : null,
    },
    availableMonths: availableMonths.map((item) => ({
      month: item.month,
      count: Number(item.count),
    })),
    transactions: rows,
    topCategories: categoryRows.map((item) => ({
      major: item.major,
      amount: Number(item.amount),
    })),
  }
}
