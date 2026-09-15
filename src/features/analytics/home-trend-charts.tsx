'use client'

import type { ChartData, ChartOptions } from 'chart.js'
import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'

import { formatRate } from '@/lib/finance'

import {
  CHART_ANIMATION,
  CHART_ANIMATIONS,
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
import { ChartLegend } from './chart-legend'
import { ROLE } from './chart-theme'

// Task 12's ruling: a legend swatch takes a raw token, never a palette value.
// useFinanceChartPalette initialises to the light FALLBACK_PALETTE and only
// corrects on the effect tick, so a dark first paint would draw the near-black
// light ink on a near-black ground. The target line is stroked at 70% green,
// so the swatch mixes the same 70% over the same ground and composites to it.
const TARGET_OPACITY_PERCENT = 70
const TARGET_SWATCH = `color-mix(in srgb, ${ROLE.saving} ${TARGET_OPACITY_PERCENT}%, var(--background))`

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
        borderColor: alpha(palette.green, TARGET_OPACITY_PERCENT / 100),
        backgroundColor: alpha(palette.green, TARGET_OPACITY_PERCENT / 100),
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
    animations: CHART_ANIMATIONS,
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
    <div>
      <ChartLegend items={[{ name: '순저축률', color: ROLE.ink }, { name: `목표 ${formatRate(target)}%`, color: TARGET_SWATCH }]} />
      <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
        <Line aria-label="올해 월별 순저축률" data={chartData} options={options} role="img" />
      </div>
    </div>
  )
}
