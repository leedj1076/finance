import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import {
  accounts,
  budgets,
  categories,
  categoryMeta,
  importInbox,
  settings,
  transactions,
} from '@/db/schema'
import { calculateBudgetPace } from '@/features/budgets/pace'
import { calculateExpenseForecast, calculateSafeToSpend } from '@/features/ledger/forecast'
import {
  currentMonthInKorea,
  isMonthKey,
  monthBounds,
  savingsRate,
  shiftMonth,
} from '@/lib/finance'

import {
  anomalyAlerts,
  categoryRanks,
  merchantRanks,
  monthlySummaries,
  sumFlow,
  type AnalyticsFlow,
  type AnalyticsRow,
} from './calculations'
import { buildAccountMonthly, buildCategoryMonthly } from './account-monthly'
import { getFinancialHealthData } from './financial-health'
import { calculateMonthPace } from './home-pace'

function validYear(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && value! >= 2000 && value! <= 2100 ? value! : fallback
}

async function latestTransactionDate(householdId: string) {
  const [latest] = await db
    .select({ date: transactions.date })
    .from(transactions)
    .where(eq(transactions.householdId, householdId))
    .orderBy(desc(transactions.date))
    .limit(1)
  return latest?.date ?? `${currentMonthInKorea()}-01`
}

async function loadRows(householdId: string, start: string, end: string): Promise<AnalyticsRow[]> {
  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      flow: transactions.flow,
      fixed: transactions.fixed,
      amount: transactions.amount,
      major: sql<string>`coalesce(${categories.major}, '미분류')`,
      sub: sql<string>`coalesce(${categories.sub}, '미분류')`,
      merchant: sql<string>`coalesce(nullif(${transactions.rawMerchant}, ''), nullif(${transactions.memo}, ''), '')`,
      accountId: transactions.accountId,
      accountName: sql<string>`coalesce(${accounts.name}, '')`,
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
    .orderBy(transactions.date, transactions.id)
}

function rowsForMonth(rows: AnalyticsRow[], month: string) {
  return rows.filter((row) => row.date.startsWith(month))
}

function effectiveBudgetMap(rows: Array<{ major: string; month: string; amount: number }>, month: string) {
  const result = new Map<string, number>()
  rows.filter((row) => row.month === '*').forEach((row) => result.set(row.major, row.amount))
  rows.filter((row) => row.month === month).forEach((row) => result.set(row.major, row.amount))
  return result
}

function parseSavingsTarget(value: string | null | undefined) {
  const parsed = Number(value ?? 30)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 80) : 30
}

export async function getDashboardData(
  householdId: string,
  requestedYear?: number,
  requestedFocusMonth?: string,
) {
  const latestDate = await latestTransactionDate(householdId)
  const fallbackYear = Number(latestDate.slice(0, 4))
  const year = validYear(requestedYear, fallbackYear)
  const yearStart = `${year}-01-01`
  const yearEnd = `${year + 1}-01-01`

  const [latestInYear] = await db
    .select({ date: transactions.date })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        gte(transactions.date, yearStart),
        lt(transactions.date, yearEnd),
      ),
    )
    .orderBy(desc(transactions.date))
    .limit(1)
  const focusMonth = isMonthKey(requestedFocusMonth) && Number(requestedFocusMonth.slice(0, 4)) === year
    ? requestedFocusMonth
    : latestInYear?.date.slice(0, 7) ?? `${year}-01`
  const previousMonth = shiftMonth(focusMonth, -1)
  const previousStart = monthBounds(previousMonth).start
  const queryStart = previousStart < yearStart ? previousStart : yearStart

  const [rows, budgetRows, targetRows, irregularRows, pendingRows, financialHealth] = await Promise.all([
    loadRows(householdId, queryStart, yearEnd),
    db
      .select({ major: budgets.major, month: budgets.month, amount: budgets.amount })
      .from(budgets)
      .where(
        and(
          eq(budgets.householdId, householdId),
          inArray(budgets.month, ['*', focusMonth]),
        ),
      ),
    db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.householdId, householdId), eq(settings.key, 'savings_target')))
      .limit(1),
    db
      .select({ major: categoryMeta.major })
      .from(categoryMeta)
      .where(and(eq(categoryMeta.householdId, householdId), eq(categoryMeta.irregular, true))),
    db
      .select({ count: sql<string>`count(*)` })
      .from(importInbox)
      .where(
        and(
          eq(importInbox.householdId, householdId),
          eq(importInbox.status, 'pending'),
        ),
      ),
    getFinancialHealthData(householdId),
  ])

  const yearRows = rows.filter((row) => row.date >= yearStart && row.date < yearEnd)
  const currentRows = rowsForMonth(rows, focusMonth)
  const previousRows = rowsForMonth(rows, previousMonth)
  const monthly = monthlySummaries(yearRows, year)
  const accountMonthly = {
    expense: buildAccountMonthly(yearRows, 'expense'),
    income: buildAccountMonthly(yearRows, 'income'),
  }
  const categoryMonthly = {
    expense: buildCategoryMonthly(yearRows, 'expense'),
    income: buildCategoryMonthly(yearRows, 'income'),
    saving: buildCategoryMonthly(yearRows, 'saving'),
  }
  const savingsTarget = parseSavingsTarget(targetRows[0]?.value)
  const budgetMap = effectiveBudgetMap(budgetRows, focusMonth)
  const irregularMajors = new Set(irregularRows.map((row) => row.major))
  const ranks = categoryRanks(currentRows, previousRows, 'expense')
  const merchants = merchantRanks(currentRows, previousRows, 8)

  const yearIncome = sumFlow(yearRows, 'income')
  const yearExpense = sumFlow(yearRows, 'expense')
  const yearSaving = sumFlow(yearRows, 'saving')
  const currentIncome = sumFlow(currentRows, 'income')
  const currentExpense = sumFlow(currentRows, 'expense')
  const currentSaving = sumFlow(currentRows, 'saving')
  const currentFixedExpense = currentRows
    .filter((row) => row.flow === 'expense' && row.fixed)
    .reduce((sum, row) => sum + row.amount, 0)
  const currentVariableExpense = currentExpense - currentFixedExpense
  const previousIncome = sumFlow(previousRows, 'income')
  const previousExpense = sumFlow(previousRows, 'expense')
  const completedMonthly = monthly.filter(
    (item) => item.active && item.month !== currentMonthInKorea(),
  )
  const averageDivisor = Math.max(completedMonthly.length || monthly.filter((item) => item.active).length, 1)
  const averageIncome = Math.round(
    completedMonthly.reduce((sum, item) => sum + item.income, 0) / averageDivisor,
  )
  const averageExpense = Math.round(
    completedMonthly.reduce((sum, item) => sum + item.expense, 0) / averageDivisor,
  )
  const totalBudget = [...budgetMap.values()].reduce((sum, amount) => sum + amount, 0)
  const ranksByMajor = new Map(ranks.map((rank) => [rank.major, rank]))
  const budgetCategories = [...new Set([...budgetMap.keys(), ...ranks.map((rank) => rank.major)])]
    .map((major) => {
      const rank = ranksByMajor.get(major) ?? {
        major,
        amount: 0,
        previous: 0,
        delta: 0,
        changeRate: null,
        percent: 0,
      }
      const budget = budgetMap.get(major) ?? 0
      return { ...rank, budget, remaining: budget - rank.amount }
    })
    .sort((left, right) => right.amount - left.amount || right.budget - left.budget)
  const paceWarnings = calculateBudgetPace(
    budgetCategories.map((row) => ({
      major: row.major,
      group: irregularMajors.has(row.major) ? 'irregular' : 'regular',
      budget: row.budget,
      actual: row.amount,
    })),
    focusMonth,
  )
  const largestExpense = [...currentRows]
    .filter((row) => row.flow === 'expense')
    .sort((left, right) => right.amount - left.amount)[0] ?? null
  const anomalies = anomalyAlerts(yearRows, focusMonth, irregularMajors)
  const merchantByCategory = new Map<string, Map<string, number>>()
  currentRows.filter((row) => row.flow === 'expense' && row.merchant).forEach((row) => {
    const merchantsForMajor = merchantByCategory.get(row.major) ?? new Map<string, number>()
    merchantsForMajor.set(row.merchant, (merchantsForMajor.get(row.merchant) ?? 0) + row.amount)
    merchantByCategory.set(row.major, merchantsForMajor)
  })
  const largestMerchantByCategory = Object.fromEntries(
    [...merchantByCategory].map(([major, merchantAmounts]) => {
      const largest = [...merchantAmounts]
        .map(([name, amount]) => ({ name, amount }))
        .sort((left, right) => right.amount - left.amount)[0]
      return [major, largest]
    }),
  )
  const pace = calculateMonthPace(focusMonth)
  const forecast = calculateExpenseForecast({
    mtd: currentExpense,
    historicalExpenseTotal: completedMonthly.reduce((sum, item) => sum + item.expense, 0),
    historicalMonthCount: completedMonthly.filter((item) => item.expense > 0).length,
    elapsed: pace.elapsed,
    daysInMonth: pace.daysInMonth,
    isCurrentMonth: focusMonth === currentMonthInKorea(),
  })
  const safeToSpend = calculateSafeToSpend({
    averageIncome,
    savingsTarget,
    mtdExpense: currentExpense,
    currentDay: pace.elapsed,
    daysInMonth: pace.daysInMonth,
    isCurrentMonth: focusMonth === currentMonthInKorea(),
  })

  const insights: Array<{
    tone: 'expense' | 'muted' | 'saving'
    text: string
  }> = []
  if (currentIncome > 0) {
    const currentRate = savingsRate(currentIncome, currentExpense)
    if (previousIncome > 0) {
      const delta = currentRate - savingsRate(previousIncome, previousExpense)
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
  ranks
    .filter((rank) => rank.previous > 0 && rank.delta >= 30_000 && !irregularMajors.has(rank.major))
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 2)
    .forEach((rank) => insights.push({
      tone: 'expense',
      text: `${rank.major} 전월보다 ${rank.delta.toLocaleString('ko-KR')}원 증가${rank.changeRate === null ? '' : ` (+${rank.changeRate.toFixed(0)}%)`}`,
    }))
  const savingCategory = [...ranks]
    .filter((rank) => rank.delta <= -30_000 && !irregularMajors.has(rank.major))
    .sort((left, right) => left.delta - right.delta)[0]
  if (savingCategory) {
    insights.push({
      tone: 'saving',
      text: `${savingCategory.major} 전월보다 ${Math.abs(savingCategory.delta).toLocaleString('ko-KR')}원 절약`,
    })
  }
  if (anomalies[0]) {
    insights.push({
      tone: 'expense',
      text: `${anomalies[0].major} 평소보다 많이 썼어요 · ${anomalies[0].current.toLocaleString('ko-KR')}원 (평소 약 ${anomalies[0].typical.toLocaleString('ko-KR')}원)`,
    })
  }
  if (largestExpense && largestExpense.amount >= 30_000) {
    insights.push({
      tone: 'muted',
      text: `최대 단일 지출 ${largestExpense.amount.toLocaleString('ko-KR')}원 · ${largestExpense.merchant || largestExpense.major}`,
    })
  }
  budgetCategories
    .filter((row) => row.budget > 0 && row.amount > row.budget)
    .sort((left, right) => left.remaining - right.remaining)
    .slice(0, 2)
    .forEach((row) => insights.push({
      tone: 'expense',
      text: `${row.major} 예산 ${Math.abs(row.remaining).toLocaleString('ko-KR')}원 초과`,
    }))

  return {
    year,
    previousYear: year - 1,
    nextYear: year + 1,
    focusMonth,
    previousMonth,
    savingsTarget,
    pendingInboxCount: Number(pendingRows[0]?.count ?? 0),
    annual: {
      income: yearIncome,
      expense: yearExpense,
      saving: yearSaving,
      netSaving: yearIncome - yearExpense,
      savingsRate: savingsRate(yearIncome, yearExpense),
      averageIncome,
      averageExpense,
      targetHitMonths: monthly.filter(
        (item) => item.active && item.income > 0 && item.savingsRate >= savingsTarget,
      ).length,
      activeMonths: monthly.filter((item) => item.active).length,
    },
    current: {
      income: currentIncome,
      expense: currentExpense,
      fixedExpense: currentFixedExpense,
      variableExpense: currentVariableExpense,
      saving: currentSaving,
      cashRemaining: currentIncome - currentExpense - currentSaving,
      netSaving: currentIncome - currentExpense,
      savingsRate: savingsRate(currentIncome, currentExpense),
      previousExpense,
      expenseDelta: currentExpense - previousExpense,
    },
    budget: {
      total: totalBudget,
      actual: currentExpense,
      remaining: totalBudget - currentExpense,
      percent: totalBudget > 0 ? (currentExpense / totalBudget) * 100 : null,
      categories: budgetCategories,
      paceWarnings,
    },
    pace,
    forecast,
    safeToSpend,
    anomalies,
    largestExpense,
    largestMerchantByCategory,
    monthly,
    accountMonthly,
    categoryMonthly,
    financialHealth,
    categoryRanks: ranks,
    merchantRanks: merchants,
    insights: insights.slice(0, 8),
  }
}

export type AnalysisRequest = {
  period?: string
  month?: string
  year?: number
  flow?: string
  accountId?: number
  major?: string
  q?: string
}

export async function getAnalysisData(householdId: string, request: AnalysisRequest) {
  const [latestDate, accountRows] = await Promise.all([
    latestTransactionDate(householdId),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.active, true)))
      .orderBy(accounts.sortOrder, accounts.name),
  ])

  const latestMonth = latestDate.slice(0, 7)
  const month = isMonthKey(request.month) ? request.month : latestMonth
  const fallbackYear = Number(month.slice(0, 4))
  const year = validYear(request.year, fallbackYear)
  const period = request.period === 'year' ? 'year' : 'month'
  const flow: AnalyticsFlow = request.flow === 'income' || request.flow === 'saving'
    ? request.flow
    : 'expense'
  const selectedAccount = accountRows.some((account) => account.id === request.accountId)
    ? request.accountId ?? null
    : null
  const previousMonth = shiftMonth(month, -1)
  const nextMonth = shiftMonth(month, 1)
  const yearStart = `${year}-01-01`
  const yearEnd = `${year + 1}-01-01`
  const previousStart = monthBounds(previousMonth).start
  const queryStart = period === 'month' && previousStart < yearStart ? previousStart : yearStart
  const rows = await loadRows(householdId, queryStart, yearEnd)
  const filteredRows = selectedAccount === null
    ? rows
    : rows.filter((row) => row.accountId === selectedAccount)
  const requestedMajor = request.major?.trim().slice(0, 100) ?? ''
  const requestedQuery = request.q?.trim().toLocaleLowerCase('ko-KR') ?? ''
  const scopedRows = filteredRows.filter((row) => (
    (!requestedMajor || row.major === requestedMajor)
    && (!requestedQuery || row.merchant.toLocaleLowerCase('ko-KR').includes(requestedQuery))
  ))
  const yearRows = scopedRows.filter((row) => row.date >= yearStart && row.date < yearEnd)
  const currentRows = period === 'month'
    ? rowsForMonth(scopedRows, month)
    : yearRows
  const previousRows = period === 'month' ? rowsForMonth(scopedRows, previousMonth) : []
  const ranks = categoryRanks(currentRows, previousRows, flow)
  const total = sumFlow(currentRows, flow)
  const previousTotal = period === 'month' ? sumFlow(previousRows, flow) : 0
  const trend = monthlySummaries(yearRows, year).map((item) => ({
    month: item.month,
    amount: item[flow],
    active: item.active,
  }))
  const topTransactions = currentRows
    .filter((row) => row.flow === flow)
    .sort((left, right) => right.amount - left.amount || right.date.localeCompare(left.date))
    .slice(0, 10)
  const topMajors = ranks.slice(0, 8).map((rank) => rank.major)
  const categoryMonthly = topMajors.map((major) => ({
    major,
    values: Array.from({ length: 12 }, (_, index) => {
      const monthKey = `${year}-${String(index + 1).padStart(2, '0')}`
      return yearRows
        .filter((row) => row.flow === flow && row.major === major && row.date.startsWith(monthKey))
        .reduce((sum, row) => sum + row.amount, 0)
    }),
  }))

  return {
    period,
    month,
    year,
    latestMonth,
    previousMonth,
    nextMonth,
    previousYear: year - 1,
    nextYear: year + 1,
    flow,
    selectedAccount,
    selectedMajor: requestedMajor,
    query: requestedQuery,
    accounts: accountRows,
    total,
    count: currentRows.filter((row) => row.flow === flow).length,
    average: currentRows.filter((row) => row.flow === flow).length > 0
      ? Math.round(total / currentRows.filter((row) => row.flow === flow).length)
      : 0,
    previousTotal,
    delta: total - previousTotal,
    changeRate: previousTotal > 0 ? ((total - previousTotal) / previousTotal) * 100 : null,
    ranks,
    merchants: period === 'month' && flow === 'expense'
      ? merchantRanks(currentRows, previousRows)
      : [],
    anomalies: period === 'month' && flow === 'expense'
      ? anomalyAlerts(yearRows, month)
      : [],
    trend,
    categoryMonthly,
    topTransactions,
  }
}
