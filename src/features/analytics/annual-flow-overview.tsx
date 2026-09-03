'use client'

import type { ChartData, ChartOptions, TooltipItem } from 'chart.js'
import { useMemo, useState } from 'react'
import { Bar, Line } from 'react-chartjs-2'

import { formatRate, formatWon } from '@/lib/finance'

import {
  CHART_LINE_WIDTH,
  CHART_POINT_RADIUS,
  CHART_POINT_RADIUS_ACTIVE,
  CHART_TICK_FONT,
  CHART_TOOLTIP_FONT,
  alpha,
  useFinanceChartPalette,
} from './chart-js'
import { compactWon } from './chart-theme'

export type AnnualFlowRow = {
  month: string
  income: number
  expense: number
  saving: number
  savingsRate: number
  active: boolean
}

export function AnnualFlowOverview({
  monthly,
  annualRate,
  savingsTarget,
}: {
  monthly: AnnualFlowRow[]
  annualRate: number
  savingsTarget: number
}) {
  const palette = useFinanceChartPalette()
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null)
  const labels = monthly.map((_, index) => `${index + 1}월`)

  const flowData = useMemo<ChartData<'bar'>>(() => ({
    labels,
    datasets: [
      { label: '수입', data: monthly.map((row) => row.active ? row.income : null), backgroundColor: palette.blue, borderWidth: 0, barPercentage: 0.78, categoryPercentage: 0.76 },
      { label: '지출', data: monthly.map((row) => row.active ? row.expense : null), backgroundColor: palette.ink, borderWidth: 0, barPercentage: 0.78, categoryPercentage: 0.76 },
      { label: '저축 납입', data: monthly.map((row) => row.active ? row.saving : null), backgroundColor: palette.green, borderWidth: 0, barPercentage: 0.78, categoryPercentage: 0.76 },
    ],
  }), [labels, monthly, palette])

  const flowOptions = useMemo<ChartOptions<'bar'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 450 },
    interaction: { mode: 'index', intersect: false },
    onHover: (_event, elements) => setHoveredMonth(elements[0]?.index ?? null),
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: palette.ink,
        bodyColor: palette.background,
        borderColor: palette.ink,
        borderWidth: 0,
        displayColors: true,
        titleColor: palette.background,
        titleFont: CHART_TOOLTIP_FONT,
        bodyFont: { ...CHART_TICK_FONT, size: 11 },
        padding: 11,
        callbacks: {
          label: (context: TooltipItem<'bar'>) => `${context.dataset.label}: ${formatWon(Number(context.raw ?? 0))}원`,
          footer: (items) => {
            const index = items[0]?.dataIndex
            if (index === undefined) return ''
            const row = monthly[index]
            return `순저축률 ${formatRate(row.savingsRate)}%`
          },
        },
      },
    },
    scales: {
      x: {
        border: { display: false },
        grid: { display: false },
        ticks: { color: palette.muted, font: CHART_TICK_FONT, maxRotation: 0 },
      },
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: palette.track, drawTicks: false },
        ticks: { color: palette.faint, font: CHART_TICK_FONT, maxTicksLimit: 4, padding: 8, callback: (value) => compactWon(Number(value)) },
      },
    },
  }), [monthly, palette])

  const rateData = useMemo<ChartData<'line'>>(() => ({
    labels,
    datasets: [
      {
        label: '순저축률',
        data: monthly.map((row) => row.active ? row.savingsRate : null),
        borderColor: palette.green,
        backgroundColor: palette.green,
        borderWidth: CHART_LINE_WIDTH,
        pointRadius: (context) => context.dataIndex === hoveredMonth ? CHART_POINT_RADIUS_ACTIVE : CHART_POINT_RADIUS,
        pointHoverRadius: CHART_POINT_RADIUS_ACTIVE,
        tension: 0.24,
        spanGaps: false,
      },
      {
        label: `목표 ${formatRate(savingsTarget)}%`,
        data: monthly.map((row) => row.active ? savingsTarget : null),
        borderColor: alpha(palette.green, 0.55),
        backgroundColor: alpha(palette.green, 0.55),
        borderDash: [5, 4],
        borderWidth: 1.25,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0,
      },
    ],
  }), [hoveredMonth, labels, monthly, palette.green, savingsTarget])

  const rateOptions = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350 },
    interaction: { mode: 'index', intersect: false },
    onHover: (_event, elements) => setHoveredMonth(elements[0]?.index ?? null),
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: palette.ink,
        bodyColor: palette.background,
        displayColors: true,
        filter: (item) => item.datasetIndex === 0,
        titleColor: palette.background,
        titleFont: CHART_TOOLTIP_FONT,
        bodyFont: { ...CHART_TICK_FONT, size: 11 },
        padding: 10,
        callbacks: { label: (context: TooltipItem<'line'>) => `순저축률: ${formatRate(Number(context.raw ?? 0))}%` },
      },
    },
    scales: {
      x: {
        border: { display: false },
        grid: { display: false },
        ticks: { display: false },
      },
      y: {
        border: { display: false },
        grid: { color: palette.track, drawTicks: false },
        ticks: { color: palette.faint, font: CHART_TICK_FONT, maxTicksLimit: 3, padding: 8, callback: (value) => `${value}%` },
      },
    },
  }), [palette])

  return (
    <section className="border-b border-finance-hairline py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h2 className="t-section text-finance-ink">수입 · 지출 · 저축</h2>
          <p className="mt-1 t-caption text-finance-faint">월별 금액과 순저축률 · 그래프에 마우스를 올리면 정확한 값을 확인합니다</p>
        </div>
        <div className="flex flex-wrap gap-4 t-caption text-finance-muted">
          <span><i className="mr-1.5 inline-block h-[9px] w-[9px] bg-finance-blue" />수입</span>
          <span><i className="mr-1.5 inline-block h-[9px] w-[9px] bg-finance-ink" />지출</span>
          <span><i className="mr-1.5 inline-block h-[9px] w-[9px] bg-finance-green" />저축 납입</span>
          <span><i className="mr-1.5 inline-block h-[7px] w-[7px] border-2 border-finance-green" />순저축률</span>
        </div>
      </div>
      <div className="mt-4 min-w-0">
        <div className="relative h-[230px] w-full" onMouseLeave={() => setHoveredMonth(null)}>
          <Bar aria-label="월별 수입 지출 저축 막대 차트" data={flowData} options={flowOptions} role="img" />
        </div>
        <div className="mt-2 grid items-center gap-3 sm:grid-cols-[120px_minmax(0,1fr)_120px]">
          <p className="t-caption text-finance-muted">순저축률 <span className="text-finance-faint">· 목표 {formatRate(savingsTarget)}%</span></p>
          <div className="relative h-[86px] min-w-0" onMouseLeave={() => setHoveredMonth(null)}>
            <Line aria-label="월별 순저축률 선 차트" data={rateData} options={rateOptions} role="img" />
          </div>
          <p className={`text-right t-body-strong ${annualRate >= savingsTarget ? 'text-finance-green' : 'text-finance-ink'}`}>{formatRate(annualRate)}% <span className="font-normal text-finance-muted">연 누적</span></p>
        </div>
      </div>
    </section>
  )
}
