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

import { parseLedgerAccountId, type LedgerFilters } from './filters'

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

async function filteredTotalsForMonth(
  householdId: string,
  month: string,
  filters: LedgerFilters,
) {
  const { start, end } = monthBounds(month)
  const accountId = parseLedgerAccountId(filters.account)
  const [row] = await db
    .select({
      count: sql<string>`count(*)`,
      income: sql<string>`coalesce(sum(case when ${transactions.flow} = 'income' then ${transactions.amount} else 0 end), 0)`,
      expense: sql<string>`coalesce(sum(case when ${transactions.flow} = 'expense' then ${transactions.amount} else 0 end), 0)`,
      saving: sql<string>`coalesce(sum(case when ${transactions.flow} = 'saving' then ${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .leftJoin(
      categories,
      and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)),
    )
    .where(
      and(
        eq(transactions.householdId, householdId),
        gte(transactions.date, start),
        lt(transactions.date, end),
        filters.account
          ? accountId === null ? sql`false` : eq(transactions.accountId, accountId)
          : undefined,
        filters.flow ? eq(transactions.flow, filters.flow) : undefined,
        filters.major ? eq(categories.major, filters.major) : undefined,
        filters.q
          ? sql`coalesce(nullif(${transactions.rawMerchant}, ''), ${transactions.memo}, '') ilike ${`%${filters.q}%`}`
          : undefined,
      ),
    )
  return {
    count: Number(row.count),
    income: Number(row.income),
    expense: Number(row.expense),
    saving: Number(row.saving),
  }
}

const emptyFilters: LedgerFilters = { account: '', flow: '', major: '', q: '' }

export async function getLedgerShellData(
  householdId: string,
  requestedMonth?: string,
  filters: LedgerFilters = emptyFilters,
) {
  const [latest] = await db
    .select({ date: transactions.date })
    .from(transactions)
    .where(eq(transactions.householdId, householdId))
    .orderBy(desc(transactions.date))
    .limit(1)

  const latestMonth = latest?.date.slice(0, 7) ?? currentMonthInKorea()
  const month = isMonthKey(requestedMonth) ? requestedMonth : latestMonth
  const [totals, filteredTotals, availableMonths] = await Promise.all([
    totalsForMonth(householdId, month),
    filteredTotalsForMonth(householdId, month, filters),
    db
      .select({
        month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
        count: sql<string>`count(*)`,
      })
      .from(transactions)
      .where(eq(transactions.householdId, householdId))
      .groupBy(sql`to_char(${transactions.date}, 'YYYY-MM')`)
      .orderBy(desc(sql`to_char(${transactions.date}, 'YYYY-MM')`)),
  ])

  return {
    month,
    previousMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    latestMonth,
    totals: {
      ...totals,
      netSaving: totals.income - totals.expense,
      savingsRate: savingsRate(totals.income, totals.expense),
    },
    filteredTotals,
    availableMonths: availableMonths.map((item) => ({
      month: item.month,
      count: Number(item.count),
    })),
  }
}

// A household will not post a thousand transactions in one month, so the cap
// is a guard against a runaway page rather than a paging boundary. It reports
// itself instead of silently dropping the tail, because the totals above the
// table count every matching row.
export const LEDGER_ROW_LIMIT = 1000

export async function getLedgerTransactions(
  householdId: string,
  month: string,
  filters: LedgerFilters = emptyFilters,
) {
  const { start, end } = monthBounds(month)
  const accountId = parseLedgerAccountId(filters.account)
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      flow: transactions.flow,
      fixed: transactions.fixed,
      categoryId: transactions.categoryId,
      major: categories.major,
      sub: categories.sub,
      memo: transactions.memo,
      rawMerchant: transactions.rawMerchant,
      amount: transactions.amount,
      accountId: transactions.accountId,
      account: accounts.name,
    })
    .from(transactions)
    .leftJoin(
      categories,
      and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)),
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
        filters.account
          ? accountId === null ? sql`false` : eq(transactions.accountId, accountId)
          : undefined,
        filters.flow ? eq(transactions.flow, filters.flow) : undefined,
        filters.major ? eq(categories.major, filters.major) : undefined,
        filters.q
          ? sql`coalesce(nullif(${transactions.rawMerchant}, ''), ${transactions.memo}, '') ilike ${`%${filters.q}%`}`
          : undefined,
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(LEDGER_ROW_LIMIT + 1)

  return {
    rows: rows.slice(0, LEDGER_ROW_LIMIT),
    truncated: rows.length > LEDGER_ROW_LIMIT,
  }
}

export async function getLedgerFormOptions(householdId: string) {
  const [accountRows, categoryRows] = await Promise.all([
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.active, true)))
      .orderBy(accounts.sortOrder, accounts.name),
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
  ])

  return { accounts: accountRows, categories: categoryRows }
}

export async function getTransactionForEdit(householdId: string, id?: number) {
  if (!id || !Number.isSafeInteger(id) || id <= 0) return null

  const [transaction] = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      flow: transactions.flow,
      fixed: transactions.fixed,
      categoryId: transactions.categoryId,
      memo: transactions.memo,
      amount: transactions.amount,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(
      and(eq(transactions.id, id), eq(transactions.householdId, householdId)),
    )
    .limit(1)

  return transaction ?? null
}
