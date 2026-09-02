import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { budgets, categories, categoryMeta, settings, transactions } from '@/db/schema'
import { currentMonthInKorea, isMonthKey, monthBounds, savingsRate, shiftMonth } from '@/lib/finance'
import { roundLikePython } from '@/features/ledger/forecast'

import { calculateBudgetPace } from './pace'

export async function getExpenseMajorNames(householdId: string) {
  const rows = await db
    .select({
      major: categories.major,
      sortOrder: sql<string>`min(${categories.sortOrder})`,
    })
    .from(categories)
    .where(
      and(
        eq(categories.householdId, householdId),
        eq(categories.kind, 'expense'),
        eq(categories.hidden, false),
      ),
    )
    .groupBy(categories.major)
    .orderBy(sql`min(${categories.sortOrder})`, categories.major)

  return rows.map((row) => row.major)
}

export async function getBudgetData(householdId: string, requestedMonth?: string) {
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
  const year = Number(month.slice(0, 4))
  const currentMonth = currentMonthInKorea()
  const averageEnd = String(year) === currentMonth.slice(0, 4)
    ? `${currentMonth}-01`
    : `${year + 1}-01-01`
  const yearStart = `${year}-01-01`

  const [
    majors,
    budgetRows,
    previousBudgetRows,
    actualRows,
    averageRows,
    yearlyTotalsRows,
    elapsedRows,
    irregularRows,
    targetRows,
  ] = await Promise.all([
    getExpenseMajorNames(householdId),
    db
      .select({ major: budgets.major, month: budgets.month, amount: budgets.amount })
      .from(budgets)
      .where(
        and(eq(budgets.householdId, householdId), inArray(budgets.month, ['*', month])),
      ),
    db
      .select({ major: budgets.major, month: budgets.month, amount: budgets.amount })
      .from(budgets)
      .where(
        and(
          eq(budgets.householdId, householdId),
          inArray(budgets.month, ['*', previousMonth]),
        ),
      ),
    db
      .select({
        major: categories.major,
        amount: sql<string>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .innerJoin(
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
      .groupBy(categories.major),
    db
      .select({
        major: categories.major,
        amount: sql<string>`sum(${transactions.amount})`,
        fixedAmount: sql<string>`sum(case when ${transactions.fixed} then ${transactions.amount} else 0 end)`,
      })
      .from(transactions)
      .innerJoin(
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
          gte(transactions.date, yearStart),
          lt(transactions.date, averageEnd),
        ),
      )
      .groupBy(categories.major),
    db
      .select({
        income: sql<string>`coalesce(sum(case when ${transactions.flow} = 'income' then ${transactions.amount} else 0 end), 0)`,
        expense: sql<string>`coalesce(sum(case when ${transactions.flow} = 'expense' then ${transactions.amount} else 0 end), 0)`,
        saving: sql<string>`coalesce(sum(case when ${transactions.flow} = 'saving' then ${transactions.amount} else 0 end), 0)`,
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
      .select({ count: sql<string>`count(distinct to_char(${transactions.date}, 'YYYY-MM'))` })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.date, yearStart),
          lt(transactions.date, averageEnd),
        ),
      ),
    db
      .select({ major: categoryMeta.major })
      .from(categoryMeta)
      .where(and(eq(categoryMeta.householdId, householdId), eq(categoryMeta.irregular, true))),
    db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.householdId, householdId), eq(settings.key, 'savings_target')))
      .limit(1),
  ])

  const effectiveMap = new Map<string, number>()
  const previousMap = new Map<string, number>()
  budgetRows.filter((row) => row.month === '*').forEach((row) => effectiveMap.set(row.major, row.amount))
  budgetRows.filter((row) => row.month === month).forEach((row) => effectiveMap.set(row.major, row.amount))
  previousBudgetRows
    .filter((row) => row.month === '*')
    .forEach((row) => previousMap.set(row.major, row.amount))
  previousBudgetRows
    .filter((row) => row.month === previousMonth)
    .forEach((row) => previousMap.set(row.major, row.amount))

  const actualMap = new Map(actualRows.map((row) => [row.major, Number(row.amount)]))
  const averageMap = new Map(averageRows.map((row) => [row.major, row]))
  const irregularSet = new Set(irregularRows.map((row) => row.major))
  const divisor = Math.max(Number(elapsedRows[0]?.count ?? 0), 1)

  const rows = majors.map((major) => {
    const historical = averageMap.get(major)
    const historicalAmount = Number(historical?.amount ?? 0)
    const fixedAmount = Number(historical?.fixedAmount ?? 0)
    const budget = effectiveMap.get(major) ?? 0
    const actual = actualMap.get(major) ?? 0
    const group = irregularSet.has(major)
      ? 'irregular'
      : historicalAmount > 0 && fixedAmount / historicalAmount >= 0.5
        ? 'fixed'
        : 'variable'

    return {
      major,
      group,
      budget,
      previousBudget: previousMap.get(major) ?? 0,
      actual,
      average: roundLikePython(historicalAmount / divisor),
      remaining: budget - actual,
      percent: budget > 0 ? (actual / budget) * 100 : null,
    }
  })

  const yearlyTotals = yearlyTotalsRows[0]
  const totalIncome = Number(yearlyTotals?.income ?? 0)
  const totalExpense = Number(yearlyTotals?.expense ?? 0)
  const totalSaving = Number(yearlyTotals?.saving ?? 0)
  const averageIncome = roundLikePython(totalIncome / divisor)
  const averageExpense = [...averageMap.values()].reduce(
    (sum, row) => sum + roundLikePython(Number(row.amount) / divisor),
    0,
  )
  const averageSaving = roundLikePython(totalSaving / divisor)
  const parsedTarget = Number(targetRows[0]?.value ?? 30)
  const savingsTarget = Number.isFinite(parsedTarget) ? Math.min(Math.max(parsedTarget, 0), 80) : 30
  const totalBudget = rows.reduce((sum, row) => sum + row.budget, 0)
  const totalActual = rows.reduce((sum, row) => sum + row.actual, 0)
  const paceWarnings = calculateBudgetPace(rows, month)

  return {
    month,
    previousMonth,
    nextMonth,
    rows,
    totalBudget,
    totalActual,
    remaining: totalBudget - totalActual,
    savingsTarget,
    averageIncome,
    averageExpense,
    averageSaving,
    currentSavingsRate: savingsRate(totalIncome, totalExpense),
    spendCeiling: roundLikePython(averageIncome * (1 - savingsTarget / 100)),
    paceWarnings,
  }
}
