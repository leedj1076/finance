import { categoryDetailMonthlyAverage } from './category-detail-calculations'
import type {
  CategoryDetail,
  CategoryDetailFlow,
  CategoryDetails,
  StatsMonthState,
} from './category-detail'
import type { AccountMonthlyData } from './account-monthly'
import { OTHER_SERIES_NAME, seriesColor } from './chart-theme'
import type { SeriesChartKind, SeriesChartSeries } from './series-chart-geometry'

export type StatsMonthlyAxis = 'category' | 'account'
export type StatsMonthlyFlow = CategoryDetailFlow

export type StatsViewState = {
  chart: SeriesChartKind
  flow: StatsMonthlyFlow
  axis: StatsMonthlyAxis
}

export const STATS_VIEW_EVENT = 'finance:stats-view-change'

function firstSearchValue(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined
  return typeof value === 'string' ? value : undefined
}

export function parseStatsViewState(params: {
  chart?: unknown
  flow?: unknown
  axis?: unknown
}): StatsViewState {
  const rawChart = firstSearchValue(params.chart)
  const rawFlow = firstSearchValue(params.flow)
  const rawAxis = firstSearchValue(params.axis)
  const chart: SeriesChartKind = rawChart === 'line' || rawChart === 'area' ? rawChart : 'stacked'
  const flow: StatsMonthlyFlow = rawFlow === 'income' || rawFlow === 'saving' ? rawFlow : 'expense'
  const axis: StatsMonthlyAxis = flow === 'expense' && rawAxis === 'account' ? 'account' : 'category'
  return { chart, flow, axis }
}

export function statsViewSearch(search: string, state: StatsViewState) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  params.set('chart', state.chart)
  params.set('flow', state.flow)
  params.set('axis', state.flow === 'expense' ? state.axis : 'category')
  return params.toString()
}

export type StatsMonthlySubRow = {
  id: string
  label: string
  major: string
  sub: string
  values: number[]
  total: number
  closedTotal: number
  provisionalTotal: number
  average: number | null
  provisionalAverage: number | null
}

export type StatsMonthlyRow = {
  id: string
  label: string
  color: string
  values: number[]
  displayValues: Array<number | null>
  total: number
  closedTotal: number
  provisionalTotal: number
  average: number | null
  provisionalAverage: number | null
  folded: string[]
  subs: StatsMonthlySubRow[]
}

export type StatsMonthlyModel = {
  series: SeriesChartSeries[]
  rows: StatsMonthlyRow[]
  monthTotals: number[]
  total: number
  closedTotal: number
  provisionalTotal: number
  average: number | null
  provisionalAverage: number | null
  activeMonths: number
  currentMonthIndex: number | null
  divisor: number
  provisionalDivisor: number
  monthStates: StatsMonthState[]
  eligibleMonths: boolean[]
  availableMonths: boolean[]
  closedMonths: boolean[]
}

export type StatsSeriesSelection = {
  seriesId: string
  month: number | null
}

export function selectedStatsMonthlyRows(
  rows: StatsMonthlyRow[],
  selectedSeriesId: string | null,
) {
  if (!selectedSeriesId) return rows
  return rows.filter((row) => row.id === selectedSeriesId)
}

export function toggleStatsSeriesSelection(
  current: StatsSeriesSelection | null,
  next: StatsSeriesSelection,
) {
  return current?.seriesId === next.seriesId && current.month === next.month ? null : next
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

/** A month whose values can be shown: every ended month plus the month in progress. */
function monthDisplayed(detail: CategoryDetail, month: number) {
  if (detail.states) return detail.states[month] !== 'future'
  return month < (detail.months.at(-1) ?? 0)
}

/** A month that counts toward official totals and averages. */
function monthClosed(detail: CategoryDetail, month: number) {
  if (detail.closedMonths) return detail.closedMonths.includes(month + 1)
  if (detail.states) return detail.states[month] === 'closed'
  return monthDisplayed(detail, month) && detail.currentMonth !== month + 1
}

/** An ended month that belongs to the provisional reporting basis. */
function monthProvisional(detail: CategoryDetail, month: number) {
  if (detail.provisionalMonths) return detail.provisionalMonths.includes(month + 1)
  const ended = detail.states
    ? detail.states[month] !== 'future' && detail.states[month] !== 'current'
    : monthDisplayed(detail, month) && detail.currentMonth !== month + 1
  if (!ended || !detail.recordedMonths) return ended
  return detail.recordedMonths.includes(month + 1) || monthClosed(detail, month)
}

/** A displayed month with a real value; an explicit closed zero is still a value. */
function monthValueDisplayed(detail: CategoryDetail, month: number) {
  if (!monthDisplayed(detail, month)) return false
  if (!detail.recordedMonths) return true
  return detail.recordedMonths.includes(month + 1) || monthClosed(detail, month)
}

function averageFor(values: number[], detail: CategoryDetail) {
  const total = values.reduce((sum, value, month) => monthDisplayed(detail, month) ? sum + value : sum, 0)
  const closedTotal = values.reduce((sum, value, month) => monthClosed(detail, month) ? sum + value : sum, 0)
  const provisionalTotal = values.reduce((sum, value, month) => monthProvisional(detail, month) ? sum + value : sum, 0)
  const provisionalDivisor = detail.provisionalDivisor ?? detail.divisor
  return {
    total,
    closedTotal,
    provisionalTotal,
    average: detail.divisor > 0 ? categoryDetailMonthlyAverage(closedTotal, 0, detail.divisor) : null,
    provisionalAverage: provisionalDivisor > 0
      ? categoryDetailMonthlyAverage(provisionalTotal, 0, provisionalDivisor)
      : null,
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
  excluded,
}: {
  detail: CategoryDetail
  excluded: ReadonlySet<string>
}) {
  const rows: StatsMonthlyRow[] = []
  const series: SeriesChartSeries[] = []
  const groups = detail.groups
    .map((group) => ({
      group,
      total: group.subs.reduce(
        (sum, sub) => sum + sub.months.reduce((monthSum, value, month) => monthSum + (monthValueDisplayed(detail, month) ? value : 0), 0),
        0,
      ),
    }))
    .filter((item) => item.total > 0)
    .sort((left, right) => right.total - left.total)

  groups.forEach(({ group }, index) => {
    const name = group.major
    const id = statsSeriesId('category', name)
    const rawDisplay = Array.from({ length: 12 }, (_, month) => (
      monthValueDisplayed(detail, month)
        ? group.subs.reduce((sum, sub) => sum + sub.months[month], 0)
        : null
    ))
    const rawValues = normalizedValues(rawDisplay)
    const subs = group.subs.map((sub) => {
      const values = sub.months.map((value, month) => (
        !monthValueDisplayed(detail, month) || excluded.has(statsCellKey({ axis: 'category', label: name, sub: sub.sub, month }))
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
      if (!monthValueDisplayed(detail, month) || excluded.has(statsCellKey({ axis: 'category', label: name, month }))) return 0
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
      label: name,
      color,
      values,
      displayValues: rawDisplay,
      total: summary.total,
      closedTotal: summary.closedTotal,
      provisionalTotal: summary.provisionalTotal,
      average: summary.average,
      provisionalAverage: summary.provisionalAverage,
      folded: [],
      subs,
    })
    series.push({ id, label: name, color, values: values.map((value, month) => monthValueDisplayed(detail, month) ? value : null) })
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
    const rawDisplay = (monthly.series[name] ?? Array<number | null>(12).fill(null))
      .map((value, month) => monthValueDisplayed(detail, month) ? value ?? 0 : null)
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
      closedTotal: summary.closedTotal,
      provisionalTotal: summary.provisionalTotal,
      average: summary.average,
      provisionalAverage: summary.provisionalAverage,
      folded,
      subs: [],
    })
    series.push({ id, label, color, values: values.map((value, month) => monthValueDisplayed(detail, month) ? value : null) })
  })

  return { rows, series }
}

export function buildStatsMonthlyModel({
  flow,
  axis,
  details,
  accountMonthly,
  excluded,
}: {
  flow: StatsMonthlyFlow
  axis: StatsMonthlyAxis
  details: CategoryDetails
  accountMonthly: Record<'expense' | 'income', AccountMonthlyData>
  excluded: ReadonlySet<string>
}): StatsMonthlyModel {
  const effectiveAxis = flow === 'expense' ? axis : 'category'
  const detail = details[flow]
  const result = effectiveAxis === 'account'
    ? buildAccountModel({ detail, monthly: accountMonthly.expense, excluded })
    : buildCategoryModel({ detail, excluded })
  const monthTotals = Array.from({ length: 12 }, (_, month) => (
    result.series.reduce((sum, item) => sum + (item.values[month] ?? 0), 0)
  ))
  const currentMonthIndex = detail.currentMonth ? detail.currentMonth - 1 : null
  const displayMask = Array.from({ length: 12 }, (_, month) => monthDisplayed(detail, month))
  const availableMask = Array.from({ length: 12 }, (_, month) => monthValueDisplayed(detail, month))
  const closedMask = Array.from({ length: 12 }, (_, month) => monthClosed(detail, month))
  const provisionalMask = Array.from({ length: 12 }, (_, month) => monthProvisional(detail, month))
  const total = monthTotals.reduce((sum, value, month) => displayMask[month] ? sum + value : sum, 0)
  const closedTotal = monthTotals.reduce((sum, value, month) => closedMask[month] ? sum + value : sum, 0)
  const provisionalTotal = monthTotals.reduce((sum, value, month) => provisionalMask[month] ? sum + value : sum, 0)
  const provisionalDivisor = detail.provisionalDivisor ?? detail.divisor
  const activeMonths = effectiveAxis === 'account'
    ? latestActiveMonth(Object.values(accountMonthly.expense.series))
    : detail.months.at(-1) ?? 0

  return {
    ...result,
    monthTotals,
    total,
    closedTotal,
    provisionalTotal,
    average: detail.divisor > 0 ? categoryDetailMonthlyAverage(closedTotal, 0, detail.divisor) : null,
    provisionalAverage: provisionalDivisor > 0
      ? categoryDetailMonthlyAverage(provisionalTotal, 0, provisionalDivisor)
      : null,
    activeMonths: detail.states ? displayMask.lastIndexOf(true) + 1 : activeMonths,
    currentMonthIndex,
    divisor: detail.divisor,
    provisionalDivisor,
    monthStates: detail.states ?? Array.from({ length: 12 }, (_, month): StatsMonthState => displayMask[month] ? 'open' : 'future'),
    eligibleMonths: displayMask,
    availableMonths: availableMask,
    closedMonths: closedMask,
  }
}

export function statsSparkline(values: Array<number | null>, flow: StatsMonthlyFlow, activeMonths = values.length, preserveRecordedMonths = false, closedMonths?: readonly boolean[]) {
  const relevant = values.slice(0, Math.max(0, Math.min(activeMonths, values.length)))
  while (relevant.length && relevant.at(-1) === null) relevant.pop()
  const firstValue = relevant.findIndex((value) => value !== null && (preserveRecordedMonths || value > 0))
  const active = firstValue < 0 ? [] : relevant.slice(firstValue)
  const points = active.slice(-6)
  if (points.length < 2) return null
  const recorded = points.filter((value): value is number => value !== null)
  if (recorded.length < 2) return null
  const max = Math.max(...recorded, 1)
  const min = Math.min(...recorded)
  const range = Math.max(max - min, 1)
  const step = 76 / Math.max(points.length - 1, 1)
  const yValues = points.map((value) => value === null ? null : 3 + ((max - value) / range) * 14)
  const split = Math.max(Math.floor(points.length / 2), 1)
  const firstPoints = points.slice(0, split).filter((value): value is number => value !== null)
  const lastPoints = points.slice(split).filter((value): value is number => value !== null)
  const first = firstPoints.reduce((sum, value) => sum + value, 0) / Math.max(firstPoints.length, 1)
  const last = lastPoints.reduce((sum, value) => sum + value, 0) / Math.max(lastPoints.length, 1)
  const change = first > 0 ? (last - first) / first : 0
  const increasing = change > 0.08
  const decreasing = change < -0.08
  const goodIncrease = flow !== 'expense'
  const tone = increasing
    ? goodIncrease ? 'green' : 'red'
    : decreasing
      ? goodIncrease ? 'red' : 'green'
      : 'muted'

  const segments: string[] = []
  const provisionalSegments: boolean[] = []
  const allPoints: string[] = []
  const firstMonth = relevant.length - points.length
  let segment: string[] = []
  let segmentProvisional = false
  let lastProvisional = false
  let lastX = 2
  let lastY = 10
  const finishSegment = () => {
    if (!segment.length) return
    segments.push(segment.join(' '))
    provisionalSegments.push(segmentProvisional)
  }
  for (let i = 0; i < yValues.length; i++) {
    const y = yValues[i]
    if (y === null) {
      finishSegment()
      segment = []
    } else {
      const provisional = closedMonths ? !closedMonths[firstMonth + i] : false
      const edgeProvisional = segment.length ? lastProvisional || provisional : provisional
      if (segment.length > 1 && segmentProvisional !== edgeProvisional) {
        finishSegment()
        segment = [segment[segment.length - 1]]
      }
      segmentProvisional = edgeProvisional
      lastProvisional = provisional
      lastX = 2 + i * step; lastY = y
      const point = `${lastX},${y.toFixed(1)}`
      segment.push(point)
      allPoints.push(point)
    }
  }
  finishSegment()
  return {
    points: allPoints.join(' '), segments, provisionalSegments, lastX, lastY, lastProvisional,
    color: tone === 'green'
      ? 'var(--finance-green)'
      : tone === 'red'
        ? 'var(--finance-red)'
        : 'var(--finance-muted)',
  }
}
