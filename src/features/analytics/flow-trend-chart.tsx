'use client'

import type { ChartData, ChartOptions, TooltipItem } from 'chart.js'
import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'

import { formatWon } from '@/lib/finance'

import {
  CHART_HEIGHT,
  CHART_LINE_WIDTH,
  CHART_POINT_RADIUS,
  CHART_POINT_RADIUS_ACTIVE,
  CHART_TICK_FONT,
  CHART_TOOLTIP_FONT,
  useFinanceChartPalette,
} from './chart-js'
import { compactWon, monthLabel } from './chart-theme'

type TrendPoint = {
  month: string
  amount: number
  active: boolean
}

export function FlowTrendChart({ data, label, tone }: { data: TrendPoint[]; label: string; tone: 'blue' | 'emerald' | 'rose' }) {
  const palette = useFinanceChartPalette()
  const color = tone === 'blue' ? palette.blue : tone === 'emerald' ? palette.green : palette.red
  const chartData = useMemo<ChartData<'line'>>(() => ({
    labels: data.map((row, index) => monthLabel(row.month, index)),
    datasets: [{
      label,
      data: data.map((row) => row.active ? row.amount : null),
      borderColor: color,
      backgroundColor: color,
      borderWidth: CHART_LINE_WIDTH,
      pointRadius: CHART_POINT_RADIUS,
      pointHoverRadius: CHART_POINT_RADIUS_ACTIVE,
      tension: 0.22,
    }],
  }), [color, data, label])
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
        callbacks: { label: (context: TooltipItem<'line'>) => `${label}: ${formatWon(Number(context.raw ?? 0))}원` },
      },
    },
    scales: {
      x: { border: { display: false }, grid: { display: false }, ticks: { color: palette.muted, font: CHART_TICK_FONT, maxRotation: 0 } },
      y: { beginAtZero: true, border: { display: false }, grid: { color: palette.track, drawTicks: false }, ticks: { color: palette.faint, font: CHART_TICK_FONT, maxTicksLimit: 4, padding: 8, callback: (value) => compactWon(Number(value)) } },
    },
  }), [label, palette])

  return (
    <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
      <Line aria-label={`월별 ${label} 추이`} data={chartData} options={options} role="img" />
    </div>
  )
}
