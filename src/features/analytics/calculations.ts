import { savingsRate } from '@/lib/finance'

export type AnalyticsFlow = 'expense' | 'income' | 'saving'

export type AnalyticsRow = {
  id: number
  date: string
  flow: AnalyticsFlow
  fixed: boolean
  amount: number
  major: string
  sub: string
  merchant: string
  accountId: number | null
  accountName: string
}

export type CategoryRank = {
  major: string
  amount: number
  count: number
  percent: number
  previous: number
  delta: number
  changeRate: number | null
}

export type MerchantRank = {
  name: string
  amount: number
  count: number
  previous: number
  delta: number
}

export function analyticsMonth(row: AnalyticsRow) {
  return row.date.slice(0, 7)
}

export function normalizeAnalyticsMerchant(value: string) {
  return value.replace(/[\s\d]+/g, '').toLowerCase()
}

export function monthlySummaries(rows: AnalyticsRow[], year: number) {
  const summaries = Array.from({ length: 12 }, (_, index) => ({
    month: `${year}-${String(index + 1).padStart(2, '0')}`,
    income: 0,
    expense: 0,
    saving: 0,
    savingsRate: 0,
    active: false,
  }))

  for (const row of rows) {
    if (Number(row.date.slice(0, 4)) !== year) continue
    const index = Number(row.date.slice(5, 7)) - 1
    if (index < 0 || index > 11) continue
    summaries[index][row.flow] += row.amount
    summaries[index].active = true
  }
  for (const summary of summaries) {
    summary.savingsRate = savingsRate(summary.income, summary.expense)
  }
  return summaries
}

export function categoryRanks(
  currentRows: AnalyticsRow[],
  previousRows: AnalyticsRow[],
  flow: AnalyticsFlow,
): CategoryRank[] {
  const aggregate = (rows: AnalyticsRow[]) => {
    const result = new Map<string, { amount: number; count: number }>()
    for (const row of rows) {
      if (row.flow !== flow) continue
      const previous = result.get(row.major) ?? { amount: 0, count: 0 }
      previous.amount += row.amount
      previous.count += 1
      result.set(row.major, previous)
    }
    return result
  }

  const current = aggregate(currentRows)
  const previous = aggregate(previousRows)
  const total = [...current.values()].reduce((sum, value) => sum + value.amount, 0)

  return [...new Set([...current.keys(), ...previous.keys()])]
    .map((major) => {
      const currentValue = current.get(major) ?? { amount: 0, count: 0 }
      const previousAmount = previous.get(major)?.amount ?? 0
      const delta = currentValue.amount - previousAmount
      return {
        major,
        amount: currentValue.amount,
        count: currentValue.count,
        percent: total > 0 ? (currentValue.amount / total) * 100 : 0,
        previous: previousAmount,
        delta,
        changeRate: previousAmount > 0 ? (delta / previousAmount) * 100 : null,
      }
    })
    .filter((row) => row.amount > 0)
    .sort((left, right) => right.amount - left.amount || left.major.localeCompare(right.major))
}

export function merchantRanks(
  currentRows: AnalyticsRow[],
  previousRows: AnalyticsRow[],
  limit = 15,
): MerchantRank[] {
  const current = new Map<string, { name: string; amount: number; count: number }>()
  const previous = new Map<string, number>()
  for (const row of currentRows) {
    if (row.flow !== 'expense' || !row.merchant) continue
    const key = normalizeAnalyticsMerchant(row.merchant)
    if (!key) continue
    const value = current.get(key) ?? { name: row.merchant, amount: 0, count: 0 }
    value.amount += row.amount
    value.count += 1
    current.set(key, value)
  }
  for (const row of previousRows) {
    if (row.flow !== 'expense' || !row.merchant) continue
    const key = normalizeAnalyticsMerchant(row.merchant)
    if (!key) continue
    previous.set(key, (previous.get(key) ?? 0) + row.amount)
  }

  return [...current.entries()]
    .map(([key, value]) => ({
      ...value,
      previous: previous.get(key) ?? 0,
      delta: value.amount - (previous.get(key) ?? 0),
    }))
    .sort((left, right) => right.amount - left.amount || left.name.localeCompare(right.name))
    .slice(0, limit)
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

export function anomalyAlerts(
  rows: AnalyticsRow[],
  month: string,
  irregularMajors = new Set<string>(),
  floor = 30_000,
) {
  const focusNumber = Number(month.slice(5, 7))
  const focusYear = month.slice(0, 4)
  const series = new Map<string, Map<number, number>>()

  for (const row of rows) {
    if (row.flow !== 'expense' || row.date.slice(0, 4) !== focusYear) continue
    if (irregularMajors.has(row.major)) continue
    const byMonth = series.get(row.major) ?? new Map<number, number>()
    const monthNumber = Number(row.date.slice(5, 7))
    byMonth.set(monthNumber, (byMonth.get(monthNumber) ?? 0) + row.amount)
    series.set(row.major, byMonth)
  }

  return [...series.entries()]
    .map(([major, byMonth]) => {
      const current = byMonth.get(focusNumber) ?? 0
      const history = Array.from({ length: Math.max(focusNumber - 1, 0) }, (_, index) =>
        byMonth.get(index + 1) ?? 0,
      )
      if (history.length < 2 || current < floor) return null
      const typical = median(history)
      const deviation = median(history.map((amount) => Math.abs(amount - typical))) || 1
      const modifiedZScore = (0.6745 * (current - typical)) / deviation
      if (modifiedZScore <= 3.5 || typical <= 0 || (current - typical) / typical <= 0.2) {
        return null
      }
      return {
        major,
        current,
        typical: Math.round(typical),
        delta: current - typical,
        modifiedZScore,
      }
    })
    .filter((alert): alert is NonNullable<typeof alert> => alert !== null)
    .sort((left, right) => right.delta - left.delta)
}

export function sumFlow(rows: AnalyticsRow[], flow: AnalyticsFlow) {
  return rows
    .filter((row) => row.flow === flow)
    .reduce((sum, row) => sum + row.amount, 0)
}
