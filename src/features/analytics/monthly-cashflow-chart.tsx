'use client'

import type { ChartData, ChartOptions } from 'chart.js'
import { useMemo } from 'react'
import { Bar } from 'react-chartjs-2'

import {
  CHART_ANIMATION,
  CHART_HEIGHT,
  financeScales,
  financeTooltip,
  useFinanceChartPalette,
  wonTooltipLabel,
} from './chart-js'
import { ChartLegend } from './chart-legend'
import { ROLE, monthLabel } from './chart-theme'

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
    animation: CHART_ANIMATION,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { ...financeTooltip(palette), callbacks: { label: wonTooltipLabel } },
    },
    scales: financeScales(palette),
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
