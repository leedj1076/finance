'use client'

import type { ChartData, ChartOptions, TooltipItem } from 'chart.js'
import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'

import {
  CHART_HEIGHT,
  CHART_LINE_WIDTH,
  CHART_POINT_RADIUS,
  CHART_POINT_RADIUS_ACTIVE,
  CHART_TICK_FONT,
  CHART_TOOLTIP_FONT,
  useFinanceChartPalette,
} from '@/features/analytics/chart-js'
import { ChartLegend } from '@/features/analytics/chart-primitives'
import { ROLE, compactWon, monthLabel } from '@/features/analytics/chart-theme'
import { formatWon } from '@/lib/finance'

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
    animation: { duration: 450 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: palette.ink,
        bodyColor: palette.background,
        titleColor: palette.background,
        titleFont: CHART_TOOLTIP_FONT,
        bodyFont: { ...CHART_TICK_FONT, size: 11 },
        padding: 11,
        callbacks: { label: (context: TooltipItem<'line'>) => `${context.dataset.label}: ${formatWon(Number(context.raw ?? 0))}원` },
      },
    },
    scales: {
      x: { border: { display: false }, grid: { display: false }, ticks: { color: palette.muted, font: CHART_TICK_FONT, maxRotation: 0 } },
      y: { border: { display: false }, grid: { color: palette.track, drawTicks: false }, ticks: { color: palette.faint, font: CHART_TICK_FONT, maxTicksLimit: 4, padding: 8, callback: (value) => compactWon(Number(value)) } },
    },
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
