'use client'

import type { ChartData, ChartOptions, TooltipItem } from 'chart.js'
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
import { monthLabel } from '@/features/analytics/chart-theme'
import { formatWon } from '@/lib/finance'

type TrendPoint = {
  month: string
  assets: number
  debt: number
  netWorth: number
  active: boolean
}

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
    ],
  }), [data, palette])
  const options = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: CHART_ANIMATION,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...financeTooltip(palette),
        displayColors: false,
        callbacks: {
          label: wonTooltipLabel,
          afterBody: (items: TooltipItem<'line'>[]) => {
            const row = data[items[0]?.dataIndex ?? -1]
            return row ? [`총자산: ${formatWon(row.assets)}원`, `부채: ${formatWon(row.debt)}원`] : []
          },
        },
      },
    },
    scales: financeScales(palette, { beginAtZero: false }),
  }), [data, palette])

  return (
    <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
      <Line aria-label="월별 순자산 추이" data={chartData} options={options} role="img" />
    </div>
  )
}
