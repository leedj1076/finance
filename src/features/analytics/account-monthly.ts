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
}

export type CategoryMonthlyData = {
  categories: string[]
  series: Record<string, Array<number | null>>
}

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

  const names = [...series.keys()].sort(
    (left, right) => (totals.get(right) ?? 0) - (totals.get(left) ?? 0),
  )
  const nullableSeries = Object.fromEntries(names.map((name) => [
    name,
    series.get(name)!.map((value, index) => activeMonths.has(index + 1) ? value : null),
  ]))

  return { names, series: nullableSeries }
}

export function buildAccountMonthly(
  rows: MonthlyBreakdownRow[],
  flow: AnalyticsFlow,
): AccountMonthlyData {
  const result = aggregateMonthly(rows, flow, (row) => row.accountName || '(미지정)')
  return { accounts: result.names, series: result.series }
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
  return { categories: result.names, series: result.series }
}

export function accountTableMonths(data: AccountMonthlyData) {
  return Array.from({ length: 12 }, (_, index) => index + 1).filter((month) => (
    data.accounts.reduce((sum, account) => sum + (data.series[account][month - 1] ?? 0), 0) > 0
  ))
}
