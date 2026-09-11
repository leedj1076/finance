import { roundLikePython } from '@/features/ledger/forecast'

import type { BudgetPlanRow, BudgetSource } from './plan-sources'

export function spendingCeilingForTarget({
  averageIncome,
  initialSavingsTarget,
  savingsTarget,
  serverSpendCeiling,
}: {
  averageIncome: number
  initialSavingsTarget: number
  savingsTarget: number
  serverSpendCeiling: number
}) {
  return savingsTarget === initialSavingsTarget
    ? serverSpendCeiling
    : roundLikePython(averageIncome * (1 - savingsTarget / 100))
}

export type Average3Input = {
  candidateMonths: string[]
  transactionMonths: string[]
  majorMonthlyAmounts: { month: string; amount: number }[]
  monthStatuses: { month: string; state: 'open' | 'closed' | 'needs_review' }[]
}

export function calculateAverage3(input: Average3Input): BudgetPlanRow['average3'] {
  const transactionMonths = new Set(input.transactionMonths)
  const months = input.candidateMonths.filter(month => transactionMonths.has(month))
  const retained = new Set(months)
  const amountByMonth = new Map<string, number>()
  for (const row of input.majorMonthlyAmounts) {
    if (!retained.has(row.month)) continue
    amountByMonth.set(row.month, (amountByMonth.get(row.month) ?? 0) + row.amount)
  }
  const spendMonths = months.filter(month => amountByMonth.has(month))
  const statusByMonth = new Map(input.monthStatuses.map(status => [status.month, status.state]))

  return {
    amount: months.length > 0
      ? roundLikePython(months.reduce((sum, month) => sum + (amountByMonth.get(month) ?? 0), 0) / months.length)
      : 0,
    months,
    monthsWithSpend: spendMonths.length,
    spendMonths,
    provisional: months.some(month => statusByMonth.get(month) !== 'closed'),
  }
}

export function initialSource(
  row: BudgetPlanRow,
  completedJobId: string | null,
  recommendedAmount?: number,
): BudgetSource | null {
  if (
    row.saved.amount > 0
    && completedJobId !== null
    && row.saved.recommendationJobId === completedJobId
    && recommendedAmount === row.saved.amount
  ) return 'ai'

  const historical: [BudgetSource, number][] = [
    ['previousBudget', row.previousBudget],
    ['previousActual', row.previousActual.amount],
    ['average3', row.average3.amount],
  ]
  return historical.find(([, amount]) => amount > 0 && amount === row.saved.amount)?.[0] ?? null
}

export function differenceCaption(actual: number, budget: number) {
  const difference = actual - budget
  if (difference === 0) return '예산과 같음'
  const amount = Math.abs(difference).toLocaleString('ko-KR')
  return difference > 0 ? `+${amount} 초과` : `−${amount}`
}
