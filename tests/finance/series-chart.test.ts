import { describe, expect, test } from 'vitest'

import { CHART_OTHER, seriesColor } from '@/features/analytics/chart-theme'
import {
  applySeriesExclusions,
  buildSeriesChartGeometry,
  hitTestSeriesChart,
  SERIES_PLOT_HEIGHT,
  SERIES_PLOT_TOP,
  seriesCellKey,
  type SeriesChartSeries,
} from '@/features/analytics/series-chart-geometry'

const series: SeriesChartSeries[] = [
  { id: 'food', label: '식비', color: '#2563eb', values: [30, 20, null, null, null, null, null, null, null, null, null, null] },
  { id: 'living', label: '생활', color: '#d97706', values: [70, 80, null, null, null, null, null, null, null, null, null, null] },
]

function ratioForY(y: number) {
  return y / SERIES_PLOT_HEIGHT
}

describe('series chart geometry', () => {
  test('stacks each month from zero to its total using the shared 1200 by 220 coordinates', () => {
    const geometry = buildSeriesChartGeometry(series, 'stacked', 2)
    const january = geometry.bars.filter((bar) => bar.month === 0)

    expect(geometry.monthTotals.slice(0, 3)).toEqual([100, 100, 0])
    expect(january).toHaveLength(2)
    expect(january[0]).toMatchObject({ x: 22, width: 56, seriesId: 'food' })
    expect(january.reduce((sum, bar) => sum + bar.height, 0)).toBeCloseTo(
      SERIES_PLOT_HEIGHT - SERIES_PLOT_TOP,
      5,
    )
  })

  test('normalizes every active area column to one', () => {
    const geometry = buildSeriesChartGeometry(series, 'area', 2)
    const topBand = geometry.areas.at(-1)!

    expect(topBand.upper.slice(0, 2)).toEqual([1, 1])
    expect(topBand.lower.slice(0, 2)).toEqual([0.3, 0.2])
  })

  test('zeroes excluded cells before totals and chart coordinates are built', () => {
    const excluded = applySeriesExclusions(series, new Set([seriesCellKey('living', 0)]))
    const geometry = buildSeriesChartGeometry(excluded, 'stacked', 2)

    expect(excluded[1].values[0]).toBe(0)
    expect(geometry.monthTotals[0]).toBe(30)
    expect(geometry.bars.some((bar) => bar.seriesId === 'living' && bar.month === 0)).toBe(false)
  })

  test('uses the fixed gray token for a folded other series', () => {
    expect(seriesColor(6, '그 외')).toBe(CHART_OTHER)
  })
})

describe('series chart hit testing', () => {
  test('finds the stacked interval under the pointer', () => {
    expect(hitTestSeriesChart({
      series,
      kind: 'stacked',
      activeMonths: 2,
      xRatio: 0.04,
      yRatio: ratioForY(80),
    })).toEqual({ seriesId: 'living', month: 0 })
  })

  test('finds the nearest line at the selected month', () => {
    expect(hitTestSeriesChart({
      series,
      kind: 'line',
      activeMonths: 2,
      xRatio: 0.13,
      yRatio: ratioForY(50),
    })).toEqual({ seriesId: 'living', month: 1 })
  })

  test('finds the proportional area band and ignores inactive months', () => {
    expect(hitTestSeriesChart({
      series,
      kind: 'area',
      activeMonths: 2,
      xRatio: 0.04,
      yRatio: ratioForY(170),
    })).toEqual({ seriesId: 'food', month: 0 })
    expect(hitTestSeriesChart({
      series,
      kind: 'area',
      activeMonths: 2,
      xRatio: 0.4,
      yRatio: 0.5,
    })).toBeNull()
  })
})
