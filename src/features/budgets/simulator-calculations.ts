export type VariableSpendRow = {
  major: string
  average: number
}

export type SimulationResult = {
  totalCuts: number
  simulatedExpense: number
  savingsRate: number
  targetGap: number
  targetReached: boolean
  progressPercent: number
}

function cutAmount(value: string | number | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0
}

export function quickCutAmount(average: number, percent: 10 | 20) {
  return Math.round(Math.max(average, 0) * percent / 100)
}

export function calculateVariableSpendSimulation({
  averageExpense,
  averageIncome,
  cuts,
  savingsTarget,
}: {
  averageExpense: number
  averageIncome: number
  cuts: Record<string, string | number | undefined>
  savingsTarget: number
}): SimulationResult {
  const totalCuts = Object.values(cuts).reduce<number>(
    (total, value) => total + cutAmount(value),
    0,
  )
  const simulatedExpense = Math.max(0, averageExpense - totalCuts)
  const savingsRate = averageIncome > 0
    ? (averageIncome - simulatedExpense) / averageIncome * 100
    : 0
  const targetGap = averageIncome > 0
    ? (savingsTarget / 100 - (averageIncome - simulatedExpense) / averageIncome) * averageIncome
    : 0
  const progressPercent = averageIncome > 0
    ? Math.min(100, savingsRate / Math.max(savingsTarget, 1) * 100)
    : 0

  return {
    totalCuts,
    simulatedExpense,
    savingsRate,
    targetGap,
    targetReached: targetGap <= 100,
    progressPercent,
  }
}

export function budgetAmountsFromCuts(
  rows: VariableSpendRow[],
  cuts: Record<string, string | number | undefined>,
) {
  return Object.fromEntries(
    rows.flatMap((row) => {
      const cut = cutAmount(cuts[row.major])
      if (cut <= 0) return []

      const target = Math.max(0, Math.round((row.average - cut) / 1_000) * 1_000)
      return [[row.major, String(target)]]
    }),
  )
}
