export type ExpenseForecastInput = {
  mtd: number
  historicalExpenseTotal: number
  historicalMonthCount: number
  elapsed: number
  daysInMonth: number
  isCurrentMonth: boolean
}

export type ExpenseForecast = {
  mtd: number
  projected: number
  histAvg: number
  elapsed: number
  daysInMonth: number
  basis: 'run_rate' | 'hist_avg'
  isCurrentMonth: boolean
}

// Python's round(), used by the Flask source of truth, rounds exact .5 ties to even.
export function roundLikePython(value: number) {
  const lower = Math.floor(value)
  const fraction = value - lower
  if (fraction !== 0.5) return Math.round(value)
  return lower % 2 === 0 ? lower : lower + 1
}

export function calculateExpenseForecast({
  mtd,
  historicalExpenseTotal,
  historicalMonthCount,
  elapsed,
  daysInMonth,
  isCurrentMonth,
}: ExpenseForecastInput): ExpenseForecast {
  const histAvg = historicalMonthCount > 0
    ? roundLikePython(historicalExpenseTotal / historicalMonthCount)
    : 0
  const useRunRate = isCurrentMonth && mtd > 0 && elapsed >= 5 && elapsed < daysInMonth

  return {
    mtd,
    projected: useRunRate
      ? roundLikePython((mtd / elapsed) * daysInMonth)
      : Math.max(mtd, histAvg),
    histAvg,
    elapsed,
    daysInMonth,
    basis: useRunRate ? 'run_rate' : 'hist_avg',
    isCurrentMonth,
  }
}

export type SafeToSpendInput = {
  averageIncome: number
  savingsTarget: number
  mtdExpense: number
  currentDay: number
  daysInMonth: number
  isCurrentMonth: boolean
}

export type SafeToSpend = {
  ceiling: number
  mtd: number
  remaining: number
  daily: number
  daysLeft: number
  rate: number
  hasIncome: boolean
}

export function calculateSafeToSpend({
  averageIncome,
  savingsTarget,
  mtdExpense,
  currentDay,
  daysInMonth,
  isCurrentMonth,
}: SafeToSpendInput): SafeToSpend | null {
  if (!isCurrentMonth) return null

  const ceiling = roundLikePython(averageIncome * (1 - savingsTarget / 100))
  const remaining = ceiling - mtdExpense
  const daysLeft = Math.max(1, daysInMonth - currentDay + 1)

  return {
    ceiling,
    mtd: mtdExpense,
    remaining,
    daily: roundLikePython(remaining / daysLeft),
    daysLeft,
    rate: savingsTarget,
    hasIncome: averageIncome > 0,
  }
}
