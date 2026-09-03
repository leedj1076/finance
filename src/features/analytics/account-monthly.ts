import type { AnalyticsFlow } from './calculations'

export type MonthlyBreakdownRow = {
  date: string
  flow: AnalyticsFlow
  amount: number
  accountName: string
  major: string
}

export type AccountMonthlyData = {
  accounts: string[]
  series: Record<string, Array<number | null>>
  folded?: string[]
}

export type CategoryMonthlyData = {
  categories: string[]
  series: Record<string, Array<number | null>>
  folded?: string[]
}

const OTHER_SERIES_NAME = '그 외'
const MAX_SERIES_COUNT = 6

function aggregateMonthly(
  rows: MonthlyBreakdownRow[],
  flow: AnalyticsFlow,
  nameFor: (row: MonthlyBreakdownRow) => string,
) {
  const activeMonths = new Set<number>()
  const totals = new Map<string, number>()
  const series = new Map<string, number[]>()

  for (const row of rows) {
    if (row.flow !== flow) continue
    const month = Number(row.date.slice(5, 7))
    if (!Number.isInteger(month) || month < 1 || month > 12) continue
    const name = nameFor(row)
    activeMonths.add(month)
    const values = series.get(name) ?? Array<number>(12).fill(0)
    values[month - 1] += row.amount
    series.set(name, values)
    totals.set(name, (totals.get(name) ?? 0) + row.amount)
  }

  const nullableFor = (name: string) => (
    series.get(name)!.map((value, index) => activeMonths.has(index + 1) ? value : null)
  )

  // Insertion order is preserved by Map iteration; this is the order rows first appeared.
  const insertionOrder = [...series.keys()]
  const sortedByTotal = [...insertionOrder].sort(
    (left, right) => (totals.get(right) ?? 0) - (totals.get(left) ?? 0),
  )

  // Fold only when there is more than one leftover series; hiding a single
  // series behind "그 외" would lose information for no visual benefit.
  if (sortedByTotal.length <= MAX_SERIES_COUNT + 1) {
    const names = sortedByTotal
    const nullableSeries = Object.fromEntries(names.map((name) => [name, nullableFor(name)]))
    return { names, series: nullableSeries }
  }

  const topNames = sortedByTotal.slice(0, MAX_SERIES_COUNT)
  const topSet = new Set(topNames)
  // Colors are assigned by array position, so keep the original data order for
  // the kept series: the same category should get the same color across months.
  const names = insertionOrder.filter((name) => topSet.has(name))
  const folded = sortedByTotal.slice(MAX_SERIES_COUNT)

  const nullableSeries = Object.fromEntries(names.map((name) => [name, nullableFor(name)]))

  const foldedSeries = folded.map((name) => nullableFor(name))
  const otherSeries = Array.from({ length: 12 }, (_, month) => {
    let sum = 0
    let hasValue = false
    for (const values of foldedSeries) {
      const value = values[month]
      if (value === null) continue
      sum += value
      hasValue = true
    }
    return hasValue ? sum : null
  })

  names.push(OTHER_SERIES_NAME)
  nullableSeries[OTHER_SERIES_NAME] = otherSeries

  return { names, series: nullableSeries, folded }
}

export function buildAccountMonthly(
  rows: MonthlyBreakdownRow[],
  flow: AnalyticsFlow,
): AccountMonthlyData {
  const result = aggregateMonthly(rows, flow, (row) => row.accountName || '(미지정)')
  return { accounts: result.names, series: result.series, folded: result.folded }
}

export function buildCategoryMonthly(
  rows: MonthlyBreakdownRow[],
  flow: AnalyticsFlow,
): CategoryMonthlyData {
  const result = aggregateMonthly(
    rows.filter((row) => row.major && row.major !== '미분류'),
    flow,
    (row) => row.major,
  )
  return { categories: result.names, series: result.series, folded: result.folded }
}

export function accountTableMonths(data: AccountMonthlyData) {
  return Array.from({ length: 12 }, (_, index) => index + 1).filter((month) => (
    data.accounts.reduce((sum, account) => sum + (data.series[account][month - 1] ?? 0), 0) > 0
  ))
}
