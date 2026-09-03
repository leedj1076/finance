'use client'

import type { ChartData, ChartOptions, TooltipItem } from 'chart.js'
import { useMemo } from 'react'
import { Bar } from 'react-chartjs-2'

import { formatWon } from '@/lib/finance'

import {
  CHART_HEIGHT,
  CHART_TICK_FONT,
  CHART_TOOLTIP_FONT,
  useFinanceChartPalette,
} from './chart-js'
import { ChartLegend } from './chart-primitives'
import { ROLE, compactWon, monthLabel } from './chart-theme'

type MonthlyCashflow = {
  month: string
  income: number
  expense: number
  savingsRate: number
  active: boolean
}

const LEGEND = [
  { name: '수입', color: ROLE.income },
  { name: '지출', color: ROLE.expense },
]

export function MonthlyCashflowChart({ data }: { data: MonthlyCashflow[] }) {
  const palette = useFinanceChartPalette()
  const chartData = useMemo<ChartData<'bar'>>(() => ({
    labels: data.map((item, index) => monthLabel(item.month, index)),
    datasets: [
      { label: '수입', data: data.map((row) => row.active ? row.income : null), backgroundColor: palette.blue, borderWidth: 0, barPercentage: 0.78, categoryPercentage: 0.72 },
      { label: '지출', data: data.map((row) => row.active ? row.expense : null), backgroundColor: palette.ink, borderWidth: 0, barPercentage: 0.78, categoryPercentage: 0.72 },
    ],
  }), [data, palette.blue, palette.ink])
  const options = useMemo<ChartOptions<'bar'>>(() => ({
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
        callbacks: { label: (context: TooltipItem<'bar'>) => `${context.dataset.label}: ${formatWon(Number(context.raw ?? 0))}원` },
      },
    },
    scales: {
      x: { border: { display: false }, grid: { display: false }, ticks: { color: palette.muted, font: CHART_TICK_FONT, maxRotation: 0 } },
      y: { beginAtZero: true, border: { display: false }, grid: { color: palette.track, drawTicks: false }, ticks: { color: palette.faint, font: CHART_TICK_FONT, maxTicksLimit: 4, padding: 8, callback: (value) => compactWon(Number(value)) } },
    },
  }), [palette])

  return (
    <div>
      <ChartLegend items={LEGEND} />
      <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
        <Bar aria-label="월별 수입과 지출 막대 차트" data={chartData} options={options} role="img" />
      </div>
    </div>
  )
}
