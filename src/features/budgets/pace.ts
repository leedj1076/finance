export type BudgetPaceRow = {
  major: string
  group: string
  budget: number
  actual: number
}

export type BudgetPaceWarning = {
  major: string
  budget: number
  actual: number
  projected: number
  overrun: number
  spentPercent: number
  progressPercent: number
}

export type BudgetOverrun = {
  major: string
  budget: number
  actual: number
  overrun: number
}

export function calculateBudgetOverruns(rows: BudgetPaceRow[]): BudgetOverrun[] {
  return rows
    .flatMap((row) => row.budget > 0 && row.actual > row.budget
      ? [{
          major: row.major,
          budget: row.budget,
          actual: row.actual,
          overrun: row.actual - row.budget,
        }]
      : [])
    .sort((left, right) => right.overrun - left.overrun)
}

export function todayInKorea(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
}

export function calculateBudgetPace(
  rows: BudgetPaceRow[],
  month: string,
  today = todayInKorea(),
  options: { threshold?: number; minimumAmount?: number; minimumDay?: number } = {},
): BudgetPaceWarning[] {
  if (today.slice(0, 7) !== month) return []
  const day = Number(today.slice(8, 10))
  const [year, monthNumber] = month.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const threshold = options.threshold ?? 1.15
  const minimumAmount = options.minimumAmount ?? 30_000
  const minimumDay = options.minimumDay ?? 5
  if (!Number.isInteger(day) || day < minimumDay || day > daysInMonth) return []

  return rows
    .flatMap((row) => {
      if (row.group === 'irregular' || row.budget <= 0 || row.actual < minimumAmount) return []
      const expectedByNow = row.budget * (day / daysInMonth)
      if (row.actual < expectedByNow * threshold) return []
      const projected = Math.round((row.actual / day) * daysInMonth)
      const overrun = projected - row.budget
      if (overrun <= 0) return []
      return [{
        major: row.major,
        budget: row.budget,
        actual: row.actual,
        projected,
        overrun,
        spentPercent: (row.actual / row.budget) * 100,
        progressPercent: (day / daysInMonth) * 100,
      }]
    })
    .sort((left, right) => right.overrun - left.overrun)
}
