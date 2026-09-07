'use client'

import type { ChartData, ChartOptions } from 'chart.js'
import { useMemo } from 'react'
import { Bar, Line } from 'react-chartjs-2'

import { formatRate, formatWon } from '@/lib/finance'

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
export function CashflowWaterfall({
  income,
  fixedExpense,
  variableExpense,
  saving,
  cashRemaining,
}: {
  income: number
  fixedExpense: number
  variableExpense: number
  saving: number
  cashRemaining: number
}) {
  const palette = useFinanceChartPalette()
  const amounts = useMemo(() => [income, fixedExpense, variableExpense, saving, cashRemaining], [cashRemaining, fixedExpense, income, saving, variableExpense])
  const chartData = useMemo<ChartData<'bar'>>(() => {
    const afterFixed = income - fixedExpense
    const afterVariable = afterFixed - variableExpense
    const afterSaving = afterVariable - saving
    return {
      labels: ['수입', '고정비', '변동비', '저축 납입', '계좌에 남음'],
      datasets: [{
        label: '금액',
        data: [
          [0, income],
          [afterFixed, income],
          [afterVariable, afterFixed],
          [afterSaving, afterVariable],
          [Math.min(0, cashRemaining), Math.max(0, cashRemaining)],
        ],
        backgroundColor: [palette.blue, palette.ink, palette.muted, palette.green, cashRemaining >= 0 ? alpha(palette.green, 0.65) : palette.red],
        borderColor: [palette.blue, palette.ink, palette.muted, palette.green, cashRemaining >= 0 ? palette.green : palette.red],
        borderWidth: [0, 0, 0, 0, 1.5],
        barPercentage: 0.65,
        categoryPercentage: 0.78,
      }],
    }
  }, [cashRemaining, fixedExpense, income, palette, saving, variableExpense])
  const options = useMemo<ChartOptions<'bar'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: CHART_ANIMATION,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...financeTooltip(palette),
        callbacks: {
          label: (context) => {
            const value = amounts[context.dataIndex] ?? 0
            const prefix = context.dataIndex > 0 && context.dataIndex < 4 ? '−' : value < 0 ? '−' : ''
            return `${prefix}${formatWon(Math.abs(value))}원`
          },
        },
      },
    },
    scales: financeScales(palette, { beginAtZero: false }),
  }), [amounts, palette])

  return (
    <div>
      <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
        <Bar aria-label="이번 달 수입에서 고정비 변동비 저축 납입을 뺀 현금흐름" data={chartData} options={options} role="img" />
      </div>
      <p className="mt-2 t-caption text-finance-faint">단위 원 · 순저축 = 저축 납입 + 계좌 잔여</p>
    </div>
  )
}
