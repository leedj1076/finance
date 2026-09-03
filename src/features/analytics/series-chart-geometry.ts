export type SeriesChartKind = 'stacked' | 'line' | 'area'

export type SeriesChartSeries = {
  id: string
  label: string
  color: string
  values: Array<number | null>
}

export type SeriesCellExclusions = ReadonlySet<string>

export const SERIES_PLOT_WIDTH = 1200
export const SERIES_PLOT_HEIGHT = 220
export const SERIES_PLOT_TOP = 6
export const SERIES_MONTH_SLOT = 100
export const SERIES_BAR_INSET = 22
export const SERIES_BAR_WIDTH = 56

type BarMark = {
  seriesId: string
  month: number
  x: number
  y: number
  width: number
  height: number
  color: string
}

type LineMark = {
  seriesId: string
  color: string
  points: string
}

type AreaMark = {
  seriesId: string
  color: string
  points: string
  lower: number[]
  upper: number[]
}

export type SeriesChartGeometry = {
  bars: BarMark[]
  lines: LineMark[]
  areas: AreaMark[]
  monthTotals: number[]
  maxValue: number
}

function valueAt(series: SeriesChartSeries, month: number) {
  return Math.max(series.values[month] ?? 0, 0)
}

export function seriesCellKey(seriesId: string, month: number) {
  return `${seriesId}:${month}`
}

export function applySeriesExclusions(
  series: SeriesChartSeries[],
  excluded: SeriesCellExclusions,
) {
  return series.map((item) => ({
    ...item,
    values: item.values.map((value, month) => (
      excluded.has(seriesCellKey(item.id, month)) ? 0 : value
    )),
  }))
}

export function seriesY(value: number, maxValue: number) {
  return SERIES_PLOT_TOP
    + (SERIES_PLOT_HEIGHT - SERIES_PLOT_TOP) * (1 - value / Math.max(maxValue, 1))
}

export function buildSeriesChartGeometry(
  series: SeriesChartSeries[],
  kind: SeriesChartKind,
  activeMonths: number,
): SeriesChartGeometry {
  const visibleMonthCount = Math.min(Math.max(activeMonths, 0), 12)
  const monthTotals = Array.from({ length: 12 }, (_, month) => (
    month < visibleMonthCount
      ? series.reduce((sum, item) => sum + valueAt(item, month), 0)
      : 0
  ))
  const maxStack = Math.max(1, ...monthTotals)
  const maxSingle = Math.max(
    1,
    ...series.flatMap((item) => (
      item.values.slice(0, visibleMonthCount).map((value) => Math.max(value ?? 0, 0))
    )),
  )
  const maxValue = kind === 'stacked' ? maxStack : kind === 'line' ? maxSingle : 1
  const bars: BarMark[] = []
  const lines: LineMark[] = []
  const areas: AreaMark[] = []

  if (kind === 'stacked') {
    for (let month = 0; month < visibleMonthCount; month += 1) {
      let cumulative = 0
      for (const item of series) {
        const value = valueAt(item, month)
        if (value <= 0) continue
        const bottom = seriesY(cumulative, maxStack)
        const top = seriesY(cumulative + value, maxStack)
        bars.push({
          seriesId: item.id,
          month,
          x: month * SERIES_MONTH_SLOT + SERIES_BAR_INSET,
          y: top,
          width: SERIES_BAR_WIDTH,
          height: Math.max(bottom - top, 0.5),
          color: item.color,
        })
        cumulative += value
      }
    }
  } else if (kind === 'line') {
    for (const item of series) {
      const points = Array.from({ length: visibleMonthCount }, (_, month) => (
        `${month * SERIES_MONTH_SLOT + SERIES_MONTH_SLOT / 2},${seriesY(valueAt(item, month), maxSingle).toFixed(1)}`
      ))
      lines.push({ seriesId: item.id, color: item.color, points: points.join(' ') })
    }
  } else {
    const lower = Array<number>(12).fill(0)
    for (const item of series) {
      const upper = lower.map((value, month) => (
        month < visibleMonthCount && monthTotals[month] > 0
          ? value + valueAt(item, month) / monthTotals[month]
          : value
      ))
      const topPoints: string[] = []
      const bottomPoints: string[] = []
      for (let month = 0; month < visibleMonthCount; month += 1) {
        const x = month * SERIES_MONTH_SLOT + SERIES_MONTH_SLOT / 2
        topPoints.push(`${x},${seriesY(upper[month], 1).toFixed(1)}`)
        bottomPoints.unshift(`${x},${seriesY(lower[month], 1).toFixed(1)}`)
      }
      areas.push({
        seriesId: item.id,
        color: item.color,
        points: topPoints.concat(bottomPoints).join(' '),
        lower: [...lower],
        upper: [...upper],
      })
      for (let month = 0; month < 12; month += 1) lower[month] = upper[month]
    }
  }

  return { bars, lines, areas, monthTotals, maxValue }
}

export function hitTestSeriesChart({
  series,
  kind,
  activeMonths,
  xRatio,
  yRatio,
}: {
  series: SeriesChartSeries[]
  kind: SeriesChartKind
  activeMonths: number
  xRatio: number
  yRatio: number
}) {
  const visibleMonthCount = Math.min(Math.max(activeMonths, 0), 12)
  const month = Math.floor(xRatio * 12)
  if (month < 0 || month >= visibleMonthCount) return null

  const geometry = buildSeriesChartGeometry(series, kind, visibleMonthCount)
  const y = yRatio * SERIES_PLOT_HEIGHT
  let seriesId: string | null = null

  if (kind === 'stacked') {
    let cumulative = 0
    for (const item of series) {
      const value = valueAt(item, month)
      if (value <= 0) continue
      const bottom = seriesY(cumulative, geometry.maxValue)
      const top = seriesY(cumulative + value, geometry.maxValue)
      if (y <= bottom && y >= top) {
        seriesId = item.id
        break
      }
      cumulative += value
    }
  } else if (kind === 'line') {
    let nearest = Number.POSITIVE_INFINITY
    for (const item of series) {
      const distance = Math.abs(seriesY(valueAt(item, month), geometry.maxValue) - y)
      if (distance < nearest) {
        nearest = distance
        seriesId = item.id
      }
    }
  } else {
    const share = 1 - (y - SERIES_PLOT_TOP) / (SERIES_PLOT_HEIGHT - SERIES_PLOT_TOP)
    let lower = 0
    for (const item of series) {
      const upper = lower + (
        geometry.monthTotals[month] > 0
          ? valueAt(item, month) / geometry.monthTotals[month]
          : 0
      )
      if (share >= lower && share <= upper) {
        seriesId = item.id
        break
      }
      lower = upper
    }
  }

  return seriesId ? { seriesId, month } : null
}
