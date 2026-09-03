import { categoryDetailMonthlyAverage } from './category-detail-calculations'
import type {
  CategoryDetail,
  CategoryDetailFlow,
  CategoryDetails,
} from './category-detail'
import type {
  AccountMonthlyData,
  CategoryMonthlyData,
} from './account-monthly'
import { OTHER_SERIES_NAME, seriesColor } from './chart-theme'
import type { SeriesChartSeries } from './series-chart-geometry'

export type StatsMonthlyAxis = 'category' | 'account'
export type StatsMonthlyFlow = CategoryDetailFlow

export type StatsMonthlySubRow = {
  id: string
  label: string
  major: string
  sub: string
  values: number[]
  total: number
  average: number
}

export type StatsMonthlyRow = {
  id: string
  label: string
  color: string
  values: number[]
  displayValues: Array<number | null>
  total: number
  average: number
  folded: string[]
  subs: StatsMonthlySubRow[]
}

export type StatsMonthlyModel = {
  series: SeriesChartSeries[]
  rows: StatsMonthlyRow[]
  monthTotals: number[]
  total: number
  average: number
  activeMonths: number
  currentMonthIndex: number | null
  divisor: number
}

export function statsSeriesId(axis: StatsMonthlyAxis, label: string) {
  return `${axis}\u0000${label}`
}

export function statsCellKey({
  axis,
  label,
  month,
  sub,
}: {
  axis: StatsMonthlyAxis
  label: string
  month: number
  sub?: string
}) {
  return JSON.stringify([axis, label, sub ?? null, month])
}

function normalizedValues(values: Array<number | null> | undefined) {
  return Array.from({ length: 12 }, (_, month) => values?.[month] ?? 0)
}

function averageFor(values: number[], detail: CategoryDetail) {
  const total = values.reduce((sum, value) => sum + value, 0)
  const current = detail.currentMonth ? values[detail.currentMonth - 1] : 0
  return {
    total,
    average: categoryDetailMonthlyAverage(total, current, detail.divisor),
  }
}

function latestActiveMonth(series: Array<Array<number | null>>) {
  for (let month = 11; month >= 0; month -= 1) {
    if (series.some((values) => values[month] !== null)) return month + 1
  }
  return 0
}

function buildCategoryModel({
  detail,
  monthly,
  excluded,
}: {
  detail: CategoryDetail
  monthly: CategoryMonthlyData
  excluded: ReadonlySet<string>
}) {
  const groups = new Map(detail.groups.map((group) => [group.major, group]))
  const rows: StatsMonthlyRow[] = []
  const series: SeriesChartSeries[] = []

  monthly.categories.forEach((name, index) => {
    const id = statsSeriesId('category', name)
    const group = groups.get(name)
    const rawDisplay = monthly.series[name] ?? Array<number | null>(12).fill(null)
    const rawValues = normalizedValues(rawDisplay)
    const folded = name === OTHER_SERIES_NAME ? monthly.folded ?? [] : []
    const label = name === OTHER_SERIES_NAME && folded.length > 0
      ? `그 외 ${folded.length}개 대분류`
      : name
    const subs = (group?.subs ?? []).map((sub) => {
      const values = sub.months.map((value, month) => (
        excluded.has(statsCellKey({ axis: 'category', label: name, sub: sub.sub, month }))
          ? 0
          : value
      ))
      return {
        id: `${id}\u0000${sub.sub}`,
        label: sub.sub,
        major: name,
        sub: sub.sub,
        values,
        ...averageFor(values, detail),
      }
    })
    const values = rawValues.map((rawValue, month) => {
      if (excluded.has(statsCellKey({ axis: 'category', label: name, month }))) return 0
      if (!group) return rawValue
      const excludedSubTotal = group.subs.reduce((sum, sub) => (
        excluded.has(statsCellKey({ axis: 'category', label: name, sub: sub.sub, month }))
          ? sum + sub.months[month]
          : sum
      ), 0)
      return Math.max(rawValue - excludedSubTotal, 0)
    })
    const summary = averageFor(values, detail)
    const color = seriesColor(index, name)
    rows.push({
      id,
      label,
      color,
      values,
      displayValues: rawDisplay,
      total: summary.total,
      average: summary.average,
      folded,
      subs,
    })
    series.push({ id, label, color, values })
  })

  return { rows, series }
}

function buildAccountModel({
  detail,
  monthly,
  excluded,
}: {
  detail: CategoryDetail
  monthly: AccountMonthlyData
  excluded: ReadonlySet<string>
}) {
  const rows: StatsMonthlyRow[] = []
  const series: SeriesChartSeries[] = []

  monthly.accounts.forEach((name, index) => {
    const id = statsSeriesId('account', name)
    const rawDisplay = monthly.series[name] ?? Array<number | null>(12).fill(null)
    const values = normalizedValues(rawDisplay).map((value, month) => (
      excluded.has(statsCellKey({ axis: 'account', label: name, month })) ? 0 : value
    ))
    const folded = name === OTHER_SERIES_NAME ? monthly.folded ?? [] : []
    const label = name === OTHER_SERIES_NAME && folded.length > 0
      ? `그 외 ${folded.length}개 결제수단`
      : name
    const summary = averageFor(values, detail)
    const color = seriesColor(index, name)
    rows.push({
      id,
      label,
      color,
      values,
      displayValues: rawDisplay,
      total: summary.total,
      average: summary.average,
      folded,
      subs: [],
    })
    series.push({ id, label, color, values })
  })

  return { rows, series }
}

export function buildStatsMonthlyModel({
  flow,
  axis,
  details,
  categoryMonthly,
  accountMonthly,
  excluded,
}: {
  flow: StatsMonthlyFlow
  axis: StatsMonthlyAxis
  details: CategoryDetails
  categoryMonthly: Record<StatsMonthlyFlow, CategoryMonthlyData>
  accountMonthly: Record<'expense' | 'income', AccountMonthlyData>
  excluded: ReadonlySet<string>
}): StatsMonthlyModel {
  const effectiveAxis = flow === 'expense' ? axis : 'category'
  const detail = details[flow]
  const result = effectiveAxis === 'account'
    ? buildAccountModel({ detail, monthly: accountMonthly.expense, excluded })
    : buildCategoryModel({ detail, monthly: categoryMonthly[flow], excluded })
  const monthTotals = Array.from({ length: 12 }, (_, month) => (
    result.series.reduce((sum, item) => sum + (item.values[month] ?? 0), 0)
  ))
  const currentMonthIndex = detail.currentMonth ? detail.currentMonth - 1 : null
  const total = monthTotals.reduce((sum, value) => sum + value, 0)
  const current = currentMonthIndex === null ? 0 : monthTotals[currentMonthIndex]
  const rawSeries = effectiveAxis === 'account'
    ? Object.values(accountMonthly.expense.series)
    : Object.values(categoryMonthly[flow].series)

  return {
    ...result,
    monthTotals,
    total,
    average: categoryDetailMonthlyAverage(total, current, detail.divisor),
    activeMonths: latestActiveMonth(rawSeries),
    currentMonthIndex,
    divisor: detail.divisor,
  }
}

export function statsSparkline(values: number[], flow: StatsMonthlyFlow) {
  const active = values.reduce<number[]>((result, value, month) => {
    if (value > 0 || result.length > 0 || values.slice(month + 1).some((next) => next > 0)) result.push(value)
    return result
  }, [])
  const points = active.slice(-6)
  if (points.length < 2) return null
  const max = Math.max(...points, 1)
  const min = Math.min(...points)
  const range = Math.max(max - min, 1)
  const step = 76 / Math.max(points.length - 1, 1)
  const yValues = points.map((value) => 3 + ((max - value) / range) * 14)
  const split = Math.max(Math.floor(points.length / 2), 1)
  const first = points.slice(0, split).reduce((sum, value) => sum + value, 0) / split
  const lastCount = points.length - split
  const last = points.slice(split).reduce((sum, value) => sum + value, 0) / Math.max(lastCount, 1)
  const change = first > 0 ? (last - first) / first : 0
  const increasing = change > 0.08
  const decreasing = change < -0.08
  const goodIncrease = flow !== 'expense'
  const tone = increasing
    ? goodIncrease ? 'green' : 'red'
    : decreasing
      ? goodIncrease ? 'red' : 'green'
      : 'muted'

  return {
    points: yValues.map((y, index) => `${2 + index * step},${y.toFixed(1)}`).join(' '),
    lastY: yValues.at(-1) ?? 10,
    color: tone === 'green'
      ? 'var(--finance-green)'
      : tone === 'red'
        ? 'var(--finance-red)'
        : 'var(--finance-muted)',
  }
}
