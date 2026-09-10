import { savingsRate } from '@/lib/finance'

import type { BudgetEvaluation, BudgetRecommendationSnapshot } from './types'

export function safeBudgetSum(values: number[]): number {
  return values.reduce((total, value) => {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) {
      throw new Error('invalid_amount')
    }
    return total + value
  }, 0)
}

export function recommendationFloor(actual: number, recurring: number, planned: number): number {
  return Math.max(0, safeBudgetSum([actual, recurring, planned]))
}

export function evaluateBudget(
  snapshot: BudgetRecommendationSnapshot,
  amounts: { major: string; amount: number }[],
): BudgetEvaluation {
  const sourceRows = new Map(snapshot.rows.map((row) => [row.major, row]))
  const seen = new Set<string>()

  if (sourceRows.size !== snapshot.rows.length || amounts.length !== snapshot.rows.length) {
    throw new Error('invalid_amount')
  }

  const rows = amounts.map(({ major, amount }) => {
    const source = sourceRows.get(major)
    if (!source || seen.has(major) || !Number.isSafeInteger(amount) || amount < 0) {
      throw new Error('invalid_amount')
    }
    seen.add(major)
    return {
      major,
      amount,
      remainingAllocation: safeBudgetSum([amount, -source.actual]),
    }
  })

  const allocated = safeBudgetSum(rows.map((row) => row.amount))
  const unallocatedReserve = safeBudgetSum([
    snapshot.current.unallocatedActual,
    snapshot.current.unallocatedRecurring,
  ])
  const total = safeBudgetSum([allocated, unallocatedReserve])
  const overage = Math.max(0, safeBudgetSum([total, -snapshot.basis.spendCeiling]))

  return {
    allocated,
    unallocatedReserve,
    total,
    overage,
    savingsRate: savingsRate(snapshot.basis.averageIncome, total),
    rows,
  }
}
