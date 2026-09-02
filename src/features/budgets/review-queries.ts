import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { budgets, categories, categoryMeta, settings, transactions } from '@/db/schema'
import { currentMonthInKorea, isMonthKey, monthBounds, savingsRate, shiftMonth } from '@/lib/finance'

import { medianAmount, suggestedBudget, type ReviewGroup } from './review-calculations'
import { getExpenseMajorNames } from './queries'

export async function getBudgetReviewData(householdId: string, requestedTargetMonth?: string) {
  const targetMonth = isMonthKey(requestedTargetMonth) ? requestedTargetMonth : currentMonthInKorea()
  const reviewMonth = shiftMonth(targetMonth, -1)
  const currentMonth = currentMonthInKorea()
  const { start: reviewStart, end: reviewEnd } = monthBounds(reviewMonth)
  const completedMonths = Array.from({ length: 6 }, (_, index) => shiftMonth(reviewMonth, -index))
    .filter((month) => month < currentMonth)
  const historyStart = completedMonths.at(-1) ? `${completedMonths.at(-1)}-01` : reviewStart
  const historyEnd = completedMonths[0] ? monthBounds(completedMonths[0]).end : reviewStart
  const monthExpression = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`

  const [
    majors,
    reviewBudgetRows,
    targetBudgetRows,
    reviewTotalsRows,
    reviewActualRows,
    monthlyRows,
    historyRows,
    elapsedRows,
    irregularRows,
    targetRows,
  ] = await Promise.all([
    getExpenseMajorNames(householdId),
    db
      .select({ major: budgets.major, month: budgets.month, amount: budgets.amount })
      .from(budgets)
      .where(and(eq(budgets.householdId, householdId), inArray(budgets.month, ['*', reviewMonth]))),
    db
      .select({ major: budgets.major, amount: budgets.amount })
      .from(budgets)
      .where(and(eq(budgets.householdId, householdId), eq(budgets.month, targetMonth))),
    db
      .select({
        income: sql<string>`coalesce(sum(case when ${transactions.flow} = 'income' then ${transactions.amount} else 0 end), 0)`,
        expense: sql<string>`coalesce(sum(case when ${transactions.flow} = 'expense' then ${transactions.amount} else 0 end), 0)`,
        saving: sql<string>`coalesce(sum(case when ${transactions.flow} = 'saving' then ${transactions.amount} else 0 end), 0)`,
      })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), gte(transactions.date, reviewStart), lt(transactions.date, reviewEnd))),
    db
      .select({ major: categories.major, amount: sql<string>`sum(${transactions.amount})` })
      .from(transactions)
      .innerJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)))
      .where(and(
        eq(transactions.householdId, householdId),
        eq(transactions.flow, 'expense'),
        gte(transactions.date, reviewStart),
        lt(transactions.date, reviewEnd),
      ))
      .groupBy(categories.major),
    completedMonths.length > 0
      ? db
          .select({ major: categories.major, month: monthExpression, amount: sql<string>`sum(${transactions.amount})` })
          .from(transactions)
          .innerJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)))
          .where(and(
            eq(transactions.householdId, householdId),
            eq(transactions.flow, 'expense'),
            inArray(monthExpression, completedMonths),
          ))
          .groupBy(categories.major, monthExpression)
      : Promise.resolve([]),
    db
      .select({
        income: sql<string>`coalesce(sum(case when ${transactions.flow} = 'income' then ${transactions.amount} else 0 end), 0)`,
        expense: sql<string>`coalesce(sum(case when ${transactions.flow} = 'expense' then ${transactions.amount} else 0 end), 0)`,
        fixedExpense: sql<string>`coalesce(sum(case when ${transactions.flow} = 'expense' and ${transactions.fixed} then ${transactions.amount} else 0 end), 0)`,
      })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), gte(transactions.date, historyStart), lt(transactions.date, historyEnd))),
    db
      .select({ count: sql<string>`count(distinct to_char(${transactions.date}, 'YYYY-MM'))` })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), gte(transactions.date, historyStart), lt(transactions.date, historyEnd))),
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

  const reviewBudgetMap = new Map<string, number>()
  reviewBudgetRows.filter((row) => row.month === '*').forEach((row) => reviewBudgetMap.set(row.major, row.amount))
  reviewBudgetRows.filter((row) => row.month === reviewMonth).forEach((row) => reviewBudgetMap.set(row.major, row.amount))
  const targetBudgetMap = new Map(targetBudgetRows.map((row) => [row.major, row.amount]))
  const actualMap = new Map(reviewActualRows.map((row) => [row.major, Number(row.amount)]))
  const irregularSet = new Set(irregularRows.map((row) => row.major))
  const monthlyByMajor = new Map<string, number[]>()
  for (const row of monthlyRows) {
    const values = monthlyByMajor.get(row.major) ?? []
    values.push(Number(row.amount))
    monthlyByMajor.set(row.major, values)
  }

  const historyTotals = historyRows[0]
  const historyExpense = Number(historyTotals?.expense ?? 0)
  const historyFixedExpense = Number(historyTotals?.fixedExpense ?? 0)
  const globalFixedRatio = historyExpense > 0 ? historyFixedExpense / historyExpense : 0
  const perMajorHistory = new Map<string, { total: number; fixed: number }>()
  if (completedMonths.length > 0) {
    const fixedRows = await db
      .select({
        major: categories.major,
        total: sql<string>`sum(${transactions.amount})`,
        fixed: sql<string>`sum(case when ${transactions.fixed} then ${transactions.amount} else 0 end)`,
      })
      .from(transactions)
      .innerJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)))
      .where(and(
        eq(transactions.householdId, householdId),
        eq(transactions.flow, 'expense'),
        gte(transactions.date, historyStart),
        lt(transactions.date, historyEnd),
      ))
      .groupBy(categories.major)
    fixedRows.forEach((row) => perMajorHistory.set(row.major, { total: Number(row.total), fixed: Number(row.fixed) }))
  }

  const rows = majors.map((major) => {
    const history = perMajorHistory.get(major)
    const group: ReviewGroup = irregularSet.has(major)
      ? 'irregular'
      : history && history.total > 0
        ? history.fixed / history.total >= 0.5 ? 'fixed' : 'variable'
        : globalFixedRatio >= 0.5 && (reviewBudgetMap.get(major) ?? 0) > 0 ? 'fixed' : 'variable'
    const previousBudget = reviewBudgetMap.get(major) ?? 0
    const previousActual = actualMap.get(major) ?? 0
    const median = medianAmount(monthlyByMajor.get(major) ?? [])
    const existing = targetBudgetMap.get(major) ?? null
    return {
      major,
      group,
      previousBudget,
      previousActual,
      difference: previousActual - previousBudget,
      median,
      existing,
      suggestion: suggestedBudget({ group, existing, previousBudget, previousActual, median }),
    }
  })

  const reviewTotals = reviewTotalsRows[0]
  const reviewIncome = Number(reviewTotals?.income ?? 0)
  const reviewExpense = Number(reviewTotals?.expense ?? 0)
  const reviewSaving = Number(reviewTotals?.saving ?? 0)
  const divisor = Math.max(Number(elapsedRows[0]?.count ?? 0), 1)
  const averageIncome = Math.round(Number(historyTotals?.income ?? 0) / divisor)
  const parsedTarget = Number(targetRows[0]?.value ?? 30)
  const savingsTarget = Number.isFinite(parsedTarget) ? Math.min(Math.max(parsedTarget, 0), 80) : 30
  const spendCeiling = Math.round(averageIncome * (1 - savingsTarget / 100))

  return {
    targetMonth,
    reviewMonth,
    completedMonths,
    rows,
    groups: (['fixed', 'variable', 'irregular'] as ReviewGroup[]).map((key) => ({
      key,
      rows: rows.filter((row) => row.group === key),
    })),
    reviewIncome,
    reviewExpense,
    reviewSaving,
    reviewSavingsRate: savingsRate(reviewIncome, reviewExpense),
    reviewBudgetTotal: rows.reduce((sum, row) => sum + row.previousBudget, 0),
    existingCount: rows.filter((row) => row.existing !== null).length,
    averageIncome,
    savingsTarget,
    spendCeiling,
  }
}
