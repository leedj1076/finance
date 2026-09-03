import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { accounts, budgets, categories, importInbox, settings, transactions } from '@/db/schema'
import { calculateBudgetOverruns } from '@/features/budgets/pace'
import {
  currentMonthInKorea,
  isMonthKey,
  monthBounds,
  savingsRate,
  shiftMonth,
} from '@/lib/finance'

import { parseLedgerAccountId, type LedgerFilters } from './filters'
import { calculateExpenseForecast, calculateSafeToSpend, roundLikePython } from './forecast'

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

export async function getLedgerData(
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
  const previousMonth = shiftMonth(month, -1)
  const nextMonth = shiftMonth(month, 1)
  const { start, end } = monthBounds(month)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
  const currentMonth = today.slice(0, 7)
  const currentYear = Number(currentMonth.slice(0, 4))
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const isCurrentMonth = month === currentMonth
  const elapsed = isCurrentMonth ? Number(today.slice(8, 10)) : daysInMonth
  const yearStart = `${year}-01-01`
  const averageEnd = year === currentYear ? `${currentMonth}-01` : `${year + 1}-01-01`
  const accountId = parseLedgerAccountId(filters.account)

  const [
    totals,
    filteredTotals,
    previousTotals,
    availableMonths,
    rows,
    categoryRows,
    previousCategoryRows,
    budgetRows,
    historicalRows,
    targetRows,
    pendingRows,
    unclassifiedRows,
  ] = await Promise.all([
    totalsForMonth(householdId, month),
    filteredTotalsForMonth(householdId, month, filters),
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
    db
      .select({
        major: sql<string>`coalesce(${categories.major}, '미분류')`,
        amount: sql<string>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .leftJoin(
        categories,
        and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)),
      )
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.flow, 'expense'),
          gte(transactions.date, monthBounds(previousMonth).start),
          lt(transactions.date, monthBounds(previousMonth).end),
        ),
      )
      .groupBy(sql`coalesce(${categories.major}, '미분류')`),
    db
      .select({ major: budgets.major, month: budgets.month, amount: budgets.amount })
      .from(budgets)
      .where(
        and(eq(budgets.householdId, householdId), inArray(budgets.month, ['*', month])),
      ),
    db
      .select({
        income: sql<string>`coalesce(sum(case when ${transactions.flow} = 'income' then ${transactions.amount} else 0 end), 0)`,
        expense: sql<string>`coalesce(sum(case when ${transactions.flow} = 'expense' then ${transactions.amount} else 0 end), 0)`,
        monthCount: sql<string>`count(distinct to_char(${transactions.date}, 'YYYY-MM'))`,
        expenseMonthCount: sql<string>`count(distinct case when ${transactions.flow} = 'expense' then to_char(${transactions.date}, 'YYYY-MM') end)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.date, yearStart),
          lt(transactions.date, averageEnd),
        ),
      ),
    db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.householdId, householdId), eq(settings.key, 'savings_target')))
      .limit(1),
    db
      .select({ value: sql<string>`count(*)` })
      .from(importInbox)
      .where(and(eq(importInbox.householdId, householdId), eq(importInbox.status, 'pending'))),
    db
      .select({ value: sql<string>`count(*)` })
      .from(transactions)
      .where(and(
        eq(transactions.householdId, householdId),
        gte(transactions.date, start),
        lt(transactions.date, end),
        isNull(transactions.categoryId),
      )),
  ])

  const expenseDelta = totals.expense - previousTotals.expense
  const effectiveBudgetMap = new Map<string, number>()
  budgetRows
    .filter((row) => row.month === '*')
    .forEach((row) => effectiveBudgetMap.set(row.major, row.amount))
  budgetRows
    .filter((row) => row.month === month)
    .forEach((row) => effectiveBudgetMap.set(row.major, row.amount))
  const historical = historicalRows[0]
  const completedMonthCount = Math.max(Number(historical?.monthCount ?? 0), 1)
  const averageIncome = roundLikePython(Number(historical?.income ?? 0) / completedMonthCount)
  const parsedTarget = Number(targetRows[0]?.value ?? 30)
  const savingsTarget = Number.isFinite(parsedTarget)
    ? Math.min(Math.max(parsedTarget, 0), 80)
    : 30
  const forecast = calculateExpenseForecast({
    mtd: totals.expense,
    historicalExpenseTotal: Number(historical?.expense ?? 0),
    historicalMonthCount: Number(historical?.expenseMonthCount ?? 0),
    elapsed,
    daysInMonth,
    isCurrentMonth,
  })
  const safeToSpend = calculateSafeToSpend({
    averageIncome,
    savingsTarget,
    mtdExpense: totals.expense,
    currentDay: elapsed,
    daysInMonth,
    isCurrentMonth,
  })
  const overBudget = calculateBudgetOverruns(categoryRows.map((item) => ({
    major: item.major,
    group: '',
    budget: effectiveBudgetMap.get(item.major) ?? 0,
    actual: Number(item.amount),
  })))
  const previousCategoryMap = new Map(previousCategoryRows.map((item) => [item.major, Number(item.amount)]))
  const categoryComparisons = categoryRows
    .map((item) => {
      const amount = Number(item.amount)
      const previous = previousCategoryMap.get(item.major) ?? 0
      return { major: item.major, amount, previous, delta: amount - previous }
    })
  const insights: Array<{ tone: 'expense' | 'muted' | 'saving'; text: string; major?: string }> = []
  if (totals.income > 0) {
    const currentRate = savingsRate(totals.income, totals.expense)
    if (previousTotals.income > 0) {
      const delta = currentRate - savingsRate(previousTotals.income, previousTotals.expense)
      insights.push({
        tone: delta >= 0 ? 'saving' : 'expense',
        text: `순저축률 ${currentRate.toFixed(1)}% · 전월 대비 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%p`,
      })
    } else {
      insights.push({
        tone: currentRate >= savingsTarget ? 'saving' : 'muted',
        text: `순저축률 ${currentRate.toFixed(1)}% · 목표 ${savingsTarget}%`,
      })
    }
  }
  categoryComparisons
    .filter((item) => item.previous > 0 && item.delta >= 30_000)
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 2)
    .forEach((item) => insights.push({ tone: 'expense', major: item.major, text: `${item.major} 전월보다 ${item.delta.toLocaleString('ko-KR')}원 증가` }))
  const reduced = categoryComparisons
    .filter((item) => item.delta <= -30_000)
    .sort((left, right) => left.delta - right.delta)[0]
  if (reduced) insights.push({ tone: 'saving', major: reduced.major, text: `${reduced.major} 전월보다 ${Math.abs(reduced.delta).toLocaleString('ko-KR')}원 절약` })
  const topCategory = categoryComparisons.sort((left, right) => right.amount - left.amount)[0]
  if (topCategory) insights.push({ tone: 'muted', major: topCategory.major, text: `가장 많이 쓴 항목 ${topCategory.major} · ${topCategory.amount.toLocaleString('ko-KR')}원` })

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
    filteredTotals,
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
    forecast: {
      ...forecast,
      budget: [...effectiveBudgetMap.values()].reduce((sum, amount) => sum + amount, 0),
    },
    safeToSpend,
    overBudget,
    pendingInboxCount: Number(pendingRows[0]?.value ?? 0),
    unclassifiedCount: Number(unclassifiedRows[0]?.value ?? 0),
    hasMonthlyBudget: budgetRows.some((row) => row.month === month),
    insights: insights.slice(0, 6),
    topCategories: categoryRows.map((item) => ({
      major: item.major,
      amount: Number(item.amount),
    })),
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
