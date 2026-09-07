'use client'

import type { ChartData, ChartOptions } from 'chart.js'
import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'

import { formatWon } from '@/lib/finance'

import {
  CHART_ANIMATION,
  CHART_HEIGHT,
  CHART_LINE_WIDTH,
  CHART_POINT_RADIUS,
  CHART_POINT_RADIUS_ACTIVE,
  financeScales,
  financeTooltip,
  useFinanceChartPalette,
} from './chart-js'
import { monthLabel } from './chart-theme'

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
    animation: CHART_ANIMATION,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...financeTooltip(palette),
        callbacks: { label: (context) => `${label}: ${formatWon(Number(context.raw ?? 0))}원` },
      },
    },
    scales: financeScales(palette),
  }), [label, palette])

  return (
    <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
      <Line aria-label={`월별 ${label} 추이`} data={chartData} options={options} role="img" />
    </div>
  )
}
