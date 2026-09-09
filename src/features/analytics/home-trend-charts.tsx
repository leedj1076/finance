'use client'

import type { ChartData, ChartOptions } from 'chart.js'
import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'

import { formatRate } from '@/lib/finance'

import {
  CHART_ANIMATION,
  CHART_HEIGHT,
  CHART_LINE_WIDTH,
  CHART_POINT_RADIUS,
  CHART_POINT_RADIUS_ACTIVE,
  alpha,
  financeScales,
  financeTooltip,
  percentAxis,
  useFinanceChartPalette,
} from './chart-js'

export function SavingsRateChart({ data, target }: {
  data: Array<{ month: string; savingsRate: number; active: boolean }>
  target: number
}) {
  const palette = useFinanceChartPalette()
  const activeCount = data.filter((row) => row.active).length
  const chartData = useMemo<ChartData<'line'>>(() => ({
    labels: data.map((row, index) => row.month ? `${Number(row.month.slice(5))}월` : `${index + 1}월`),
    datasets: [
      {
        label: '순저축률',
        data: data.map((row) => row.active ? row.savingsRate : null),
        borderColor: palette.ink,
        backgroundColor: palette.ink,
        borderWidth: CHART_LINE_WIDTH,
        pointBackgroundColor: data.map((row) => row.active && row.savingsRate >= target ? palette.green : palette.background),
        pointBorderColor: data.map((row) => row.active && row.savingsRate >= target ? palette.green : palette.ink),
        pointBorderWidth: 1.25,
        pointRadius: CHART_POINT_RADIUS,
        pointHoverRadius: CHART_POINT_RADIUS_ACTIVE,
        tension: 0.22,
        spanGaps: false,
      },
      {
        label: `목표 ${formatRate(target)}%`,
        data: data.map((row) => row.active ? target : null),
        borderColor: alpha(palette.green, 0.7),
        backgroundColor: alpha(palette.green, 0.7),
        borderDash: [5, 4],
        borderWidth: 1.25,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0,
      },
    ],
  }), [data, palette, target])
  const options = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: CHART_ANIMATION,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...financeTooltip(palette),
        filter: (item) => item.datasetIndex === 0,
        callbacks: { label: (context) => `순저축률: ${formatRate(Number(context.raw ?? 0))}%` },
      },
    },
    scales: financeScales(palette, { beginAtZero: false, format: percentAxis }),
  }), [palette])

  if (activeCount === 0) return <p className="py-14 text-center t-caption text-finance-muted">올해 수입·지출 기록이 없습니다.</p>
  return (
    <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
      <Line aria-label="올해 월별 순저축률" data={chartData} options={options} role="img" />
    </div>
  )
}
