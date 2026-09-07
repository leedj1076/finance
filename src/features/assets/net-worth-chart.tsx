'use client'

import type { ChartData, ChartOptions } from 'chart.js'
import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'

import {
  CHART_ANIMATION,
  CHART_HEIGHT,
  CHART_LINE_WIDTH,
  CHART_POINT_RADIUS,
  CHART_POINT_RADIUS_ACTIVE,
  financeScales,
  financeTooltip,
  useFinanceChartPalette,
  wonTooltipLabel,
} from '@/features/analytics/chart-js'
import { ChartLegend } from '@/features/analytics/chart-legend'
import { ROLE, monthLabel } from '@/features/analytics/chart-theme'

type TrendPoint = {
  month: string
  assets: number
  debt: number
  netWorth: number
  active: boolean
}

const LEGEND = [
  { name: '순자산', color: ROLE.saving },
  { name: '총자산', color: ROLE.faint },
  { name: '부채', color: ROLE.over },
]

export function NetWorthChart({ data }: { data: TrendPoint[] }) {
  const palette = useFinanceChartPalette()
  const chartData = useMemo<ChartData<'line'>>(() => ({
    labels: data.map((row, index) => monthLabel(row.month, index)),
    datasets: [
      {
        label: '순자산',
        data: data.map((row) => row.active ? row.netWorth : null),
        borderColor: palette.green,
        backgroundColor: palette.green,
        borderWidth: CHART_LINE_WIDTH,
        pointRadius: CHART_POINT_RADIUS,
        pointHoverRadius: CHART_POINT_RADIUS_ACTIVE,
        tension: 0.22,
      },
      {
        label: '총자산',
        data: data.map((row) => row.active ? row.assets : null),
        borderColor: palette.faint,
        backgroundColor: palette.faint,
        borderDash: [5, 4],
        borderWidth: 1.25,
        pointRadius: 2,
        pointHoverRadius: CHART_POINT_RADIUS_ACTIVE,
        tension: 0.22,
      },
      {
        label: '부채',
        data: data.map((row) => row.active ? row.debt : null),
        borderColor: palette.red,
        backgroundColor: palette.red,
        borderWidth: 1.25,
        pointRadius: 2,
        pointHoverRadius: CHART_POINT_RADIUS_ACTIVE,
        tension: 0.22,
      },
    ],
  }), [data, palette])
  const options = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: CHART_ANIMATION,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { ...financeTooltip(palette), callbacks: { label: wonTooltipLabel } },
    },
    scales: financeScales(palette, { beginAtZero: false }),
  }), [palette])

  return (
    <div>
      <ChartLegend items={LEGEND} />
      <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
        <Line aria-label="월별 순자산 추이" data={chartData} options={options} role="img" />
      </div>
    </div>
  )
}
