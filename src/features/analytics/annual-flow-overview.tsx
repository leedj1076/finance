'use client'

import type { ChartData, ChartOptions } from 'chart.js'
import { useMemo, useState } from 'react'
import { Bar, Line } from 'react-chartjs-2'

import { formatRate } from '@/lib/finance'
import type { StatsMonthState } from './category-detail'

import {
  CHART_ANIMATION,
  CHART_LINE_WIDTH,
  CHART_POINT_RADIUS,
  CHART_POINT_RADIUS_ACTIVE,
  alpha,
  PROVISIONAL_DASH,
  provisionalPattern,
  financeScales,
  financeTooltip,
  monthlyEligibilityBoundary,
  percentAxis,
  useFinanceChartPalette,
  wonTooltipLabel,
} from './chart-js'

export type AnnualFlowRow = {
  month: string
  income: number
  expense: number
  saving: number
  savingsRate: number
  active: boolean
  state: StatsMonthState
  hasTransactions: boolean
}

export function AnnualFlowOverview({
  monthly,
  annualRate,
  provisionalRate,
  savingsTarget,
}: {
  monthly: AnnualFlowRow[]
  annualRate: number
  provisionalRate: number
  savingsTarget: number
}) {
  const palette = useFinanceChartPalette()
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null)
  const labels = monthly.map((row, index) => `${index + 1}월${row.state === 'current' ? '·진행 중' : row.state === 'open' || row.state === 'needs_review' ? '·잠정' : ''}`)
  const available = (row: AnnualFlowRow) => row.active && (row.hasTransactions || row.state === 'closed')
  const eligibilityBoundary = useMemo(() => monthlyEligibilityBoundary(), [])

  const flowData = useMemo<ChartData<'bar'>>(() => {
    const hatch = provisionalPattern(palette)
    return {
      labels,
      datasets: ([['수입', 'income', palette.blue], ['지출', 'expense', palette.ink], ['저축 납입', 'saving', palette.green]] as const).map(([label, key, color]) => ({
        label, data: monthly.map(row => available(row) ? row[key] : null),
        backgroundColor: monthly.map(row => row.state === 'closed' ? color : hatch),
        borderColor: monthly.map(row => row.state === 'closed' ? color : palette.faint),
        borderWidth: 1, barPercentage: 0.78, categoryPercentage: 0.76,
      })),
    }
  }, [labels, monthly, palette])

  const flowOptions = useMemo<ChartOptions<'bar'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: CHART_ANIMATION,
    interaction: { mode: 'index', intersect: false },
    onHover: (_event, elements) => setHoveredMonth(elements[0]?.index ?? null),
    plugins: {
      legend: { display: false },
      tooltip: {
        ...financeTooltip(palette),
        callbacks: {
          label: wonTooltipLabel,
          footer: (items) => {
            const index = items[0]?.dataIndex
            if (index === undefined) return ''
            const row = monthly[index]
            return `순저축률 ${formatRate(row.savingsRate)}%`
          },
        },
      },
    },
    scales: financeScales(palette),
  }), [monthly, palette])

  const rateData = useMemo<ChartData<'line'>>(() => ({
    labels,
    datasets: [
      {
        label: '순저축률',
        data: monthly.map((row) => available(row) ? row.savingsRate : null),
        borderColor: palette.green,
        backgroundColor: palette.green,
        borderWidth: CHART_LINE_WIDTH,
        segment: {
          borderDash: context => monthly[context.p0DataIndex].state === 'closed' && monthly[context.p1DataIndex].state === 'closed' ? undefined : PROVISIONAL_DASH,
        },
        pointBackgroundColor: monthly.map(row => row.state === 'closed' ? palette.green : palette.background),
        pointBorderColor: monthly.map(row => row.state === 'closed' ? palette.background : palette.green),
        pointRadius: (context) => context.dataIndex === hoveredMonth ? CHART_POINT_RADIUS_ACTIVE : CHART_POINT_RADIUS,
        pointHoverRadius: CHART_POINT_RADIUS_ACTIVE,
        tension: 0.24,
        spanGaps: false,
      },
      {
        label: `목표 ${formatRate(savingsTarget)}%`,
        data: monthly.map((row) => available(row) ? savingsTarget : null),
        borderColor: alpha(palette.green, 0.55),
        backgroundColor: alpha(palette.green, 0.55),
        borderDash: [5, 4],
        borderWidth: 1.25,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0,
      },
    ],
  }), [hoveredMonth, labels, monthly, palette, savingsTarget])

  const rateOptions = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: CHART_ANIMATION,
    interaction: { mode: 'index', intersect: false },
    onHover: (_event, elements) => setHoveredMonth(elements[0]?.index ?? null),
    plugins: {
      legend: { display: false },
      tooltip: {
        ...financeTooltip(palette),
        filter: (item) => item.datasetIndex === 0,
        callbacks: { label: (context) => `순저축률: ${formatRate(Number(context.raw ?? 0))}%` },
      },
    },
    // Three ticks, no month labels: the bar chart directly above owns the
    // x axis and this strip is 86px tall.
    scales: financeScales(palette, {
      beginAtZero: false,
      format: percentAxis,
      showMonths: false,
      ticks: 3,
    }),
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
          <span><i className="mr-1.5 inline-block h-[9px] w-[9px] border border-finance-faint bg-[repeating-linear-gradient(135deg,var(--finance-faint)_0_1px,transparent_1px_3px)]" />미마감 · 잠정</span>
        </div>
      </div>
      <div className="mt-4 min-w-0">
        <div className="relative h-[230px] w-full" onMouseLeave={() => setHoveredMonth(null)}>
          <Bar aria-label="월별 수입 지출 저축 막대 차트" data={flowData} options={flowOptions} plugins={[eligibilityBoundary]} role="img" />
        </div>
        <div className="mt-2 grid items-center gap-3 sm:grid-cols-[120px_minmax(0,1fr)_180px]">
          <p className="t-caption text-finance-muted">순저축률 <span className="text-finance-faint">· 목표 {formatRate(savingsTarget)}%</span></p>
          <div className="relative h-[86px] min-w-0" onMouseLeave={() => setHoveredMonth(null)}>
            <Line aria-label="월별 순저축률 선 차트" data={rateData} options={rateOptions} plugins={[eligibilityBoundary]} role="img" />
          </div>
          <p className="text-right t-caption text-finance-ink"><strong>마감 {monthly.filter(row => row.state === 'closed').length}개월 {formatRate(annualRate)}%</strong><span className="mt-1 block text-finance-faint">잠정 포함 {formatRate(provisionalRate)}%</span></p>
        </div>
      </div>
    </section>
  )
}
