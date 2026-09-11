import { and, eq, inArray, sql } from 'drizzle-orm'

import { categories, transactions } from '@/db/schema'
import { readMonthStatuses } from '@/features/month-close/queries'
import { currentMonthInKorea, shiftMonth } from '@/lib/finance'

import { calculateAverage3 } from './plan-calculations'
import { todayInKorea } from './pace'
import type { BudgetReader } from './queries'

export type BudgetSource = 'previousBudget' | 'previousActual' | 'average3' | 'ai'

export type BudgetPlanRow = {
  major: string
  group: 'fixed' | 'variable' | 'irregular'
  saved: { amount: number; recommendationJobId: string | null; version: string }
  actual: number
  previousBudget: number
  previousActual: {
    amount: number
    month: string
    partial: { asOf: string } | null
  }
  average3: {
    amount: number
    months: string[]
    monthsWithSpend: number
    spendMonths?: string[]
    provisional: boolean
  }
}

type BudgetPlanInput = {
  month: string
  budgetRows: {
    major: string
    group: string
    actual: number
    previousBudget: number
  }[]
  baselineRows: ({ major: string } & BudgetPlanRow['saved'])[]
  reviewRows: { major: string; previousActual: number }[]
}

export async function readBudgetPlanRows(
  reader: BudgetReader,
  householdId: string,
  input: BudgetPlanInput,
  now = new Date(),
): Promise<BudgetPlanRow[]> {
  const currentMonth = currentMonthInKorea(now)
  const upper = input.month < currentMonth ? input.month : currentMonth
  const candidateMonths = [1, 2, 3].map(offset => shiftMonth(upper, -offset))
  const monthExpression = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`
  const [transactionMonthRows, monthlyRows, monthStatuses] = await Promise.all([
    reader
      .select({ month: monthExpression })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), inArray(monthExpression, candidateMonths)))
      .groupBy(monthExpression),
    reader
      .select({
        major: categories.major,
        month: monthExpression,
        amount: sql<string>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .innerJoin(categories, and(
        eq(categories.id, transactions.categoryId),
        eq(categories.householdId, householdId),
      ))
      .where(and(
        eq(transactions.householdId, householdId),
        eq(transactions.flow, 'expense'),
        inArray(monthExpression, candidateMonths),
      ))
      .groupBy(categories.major, monthExpression),
    readMonthStatuses(reader, householdId, candidateMonths),
  ])

  const baselineByMajor = new Map(input.baselineRows.map(row => [row.major, row]))
  const previousActualByMajor = new Map(input.reviewRows.map(row => [row.major, row.previousActual]))
  const previousMonth = shiftMonth(input.month, -1)
  const partial = previousMonth === currentMonth ? { asOf: todayInKorea(now) } : null
  const transactionMonths = transactionMonthRows.map(row => row.month)

  return input.budgetRows.map(row => {
    const saved = baselineByMajor.get(row.major)
    if (!saved) throw new Error(`Missing budget baseline for ${row.major}`)
    if (row.group !== 'fixed' && row.group !== 'variable' && row.group !== 'irregular') {
      throw new Error(`Invalid budget group for ${row.major}`)
    }
    return {
      major: row.major,
      group: row.group,
      saved: {
        amount: saved.amount,
        recommendationJobId: saved.recommendationJobId,
        version: saved.version,
      },
      actual: row.actual,
      previousBudget: row.previousBudget,
      previousActual: {
        amount: previousActualByMajor.get(row.major) ?? 0,
        month: previousMonth,
        partial,
      },
      average3: calculateAverage3({
        candidateMonths,
        transactionMonths,
        majorMonthlyAmounts: monthlyRows
          .filter(month => month.major === row.major)
          .map(month => ({ month: month.month, amount: Number(month.amount) })),
        monthStatuses,
      }),
    }
  })
}
