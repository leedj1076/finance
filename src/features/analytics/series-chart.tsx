'use client'

import type { ChartData, ChartOptions } from 'chart.js'
import { useMemo } from 'react'
import { Bar, Line } from 'react-chartjs-2'

import {
  CHART_LINE_WIDTH,
  CHART_LINE_WIDTH_ACTIVE,
  CHART_POINT_RADIUS,
  CHART_POINT_RADIUS_ACTIVE,
  alpha,
  resolveChartColor,
  useFinanceChartPalette,
} from './chart-js'
import type { SeriesChartKind, SeriesChartSeries } from './series-chart-geometry'

export * from './series-chart-geometry'

function normalizedPercent(series: SeriesChartSeries[], seriesIndex: number, month: number) {
  const total = series.reduce((sum, row) => sum + Math.max(row.values[month] ?? 0, 0), 0)
  if (total <= 0) return 0
  return (Math.max(series[seriesIndex].values[month] ?? 0, 0) / total) * 100
}

export function SeriesChart({
  series,
  kind,
  currentMonthIndex,
  activeMonths,
  hoverSeries,
  hoverMonth,
  onHover,
}: {
  series: SeriesChartSeries[]
  kind: SeriesChartKind
  currentMonthIndex: number | null
  activeMonths: number
  hoverSeries: string | null
  hoverMonth: number | null
  onHover: (seriesId: string | null, month: number | null) => void
}) {
  const palette = useFinanceChartPalette()
  const labels = useMemo(() => Array.from({ length: 12 }, (_, month) => `${month + 1}월`), [])
  const isBar = kind === 'stacked'

  const data = useMemo<ChartData<'bar'> | ChartData<'line'>>(() => {
    const datasets = series.map((row, seriesIndex) => {
      const color = resolveChartColor(row.color, palette)
      const dimmed = hoverSeries !== null && hoverSeries !== row.id
      const values = Array.from({ length: 12 }, (_, month) => {
        if (month >= activeMonths) return null
        return kind === 'area' ? normalizedPercent(series, seriesIndex, month) : row.values[month] ?? 0
      })

      if (isBar) {
        return {
          id: row.id,
          label: row.label,
          data: values,
          backgroundColor: values.map((_, month) => alpha(color, dimmed ? 0.16 : month === currentMonthIndex ? 0.58 : 1)),
          borderColor: palette.background,
          borderWidth: 0.5,
          barPercentage: 0.72,
          categoryPercentage: 0.82,
        }
      }

      return {
        id: row.id,
        label: row.label,
        data: values,
        backgroundColor: kind === 'area' ? alpha(color, dimmed ? 0.08 : 0.72) : color,
        borderColor: alpha(color, dimmed ? 0.16 : 1),
        borderWidth: hoverSeries === row.id ? CHART_LINE_WIDTH_ACTIVE : CHART_LINE_WIDTH,
        fill: kind === 'area' ? 'origin' : false,
        pointBackgroundColor: color,
        pointBorderColor: palette.background,
        pointBorderWidth: 1.5,
        pointRadius: (context: { dataIndex: number }) => {
          if (hoverSeries !== row.id) return 0
          return context.dataIndex === hoverMonth ? CHART_POINT_RADIUS_ACTIVE : CHART_POINT_RADIUS
        },
        pointHoverRadius: CHART_POINT_RADIUS_ACTIVE,
        tension: kind === 'line' ? 0.22 : 0,
      }
    })
    return { labels, datasets } as ChartData<'bar'> | ChartData<'line'>
  }, [activeMonths, currentMonthIndex, hoverMonth, hoverSeries, isBar, kind, labels, palette, series])

  const commonOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'nearest' as const, intersect: false },
    onHover: (_event: unknown, elements: Array<{ datasetIndex: number; index: number }>) => {
      const element = elements[0]
      if (!element || element.index >= activeMonths) {
        onHover(null, null)
        return
      }
      onHover(series[element.datasetIndex]?.id ?? null, element.index)
    },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: {
        stacked: true,
        offset: true,
        display: false,
        border: { display: false },
        grid: { display: false },
      },
      y: {
        stacked: kind !== 'line',
        beginAtZero: true,
        max: kind === 'area' ? 100 : undefined,
        display: true,
        border: { display: false },
        grid: { color: palette.track, drawTicks: false },
        ticks: { display: false },
      },
    },
  }), [activeMonths, kind, onHover, palette.track, series])

  return (
    <div
      aria-label={`${kind === 'stacked' ? '누적 막대' : kind === 'line' ? '선' : '100% 누적 영역'} 월별 차트`}
      className="relative block h-[220px] w-full"
      onMouseLeave={() => onHover(null, null)}
      role="img"
    >
      {isBar
        ? <Bar data={data as ChartData<'bar'>} options={commonOptions as ChartOptions<'bar'>} />
        : <Line data={data as ChartData<'line'>} options={commonOptions as ChartOptions<'line'>} />}
    </div>
  )
}
