export type ReviewGroup = 'fixed' | 'variable' | 'irregular'

export function medianAmount(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

export function suggestedBudget(input: {
  group: ReviewGroup
  existing: number | null
  previousBudget: number
  previousActual: number
  median: number
}) {
  if (input.existing !== null) return input.existing
  if (input.group === 'irregular') return input.previousBudget || input.median
  if (input.group === 'fixed') return input.previousBudget || input.previousActual
  return input.median
}

export function projectedSavingsRate(averageIncome: number, budget: number) {
  if (averageIncome <= 0) return 0
  return ((averageIncome - budget) / averageIncome) * 100
}
