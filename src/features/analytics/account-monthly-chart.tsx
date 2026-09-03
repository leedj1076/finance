'use client'

import type { ChartData, ChartOptions, TooltipItem } from 'chart.js'
import { useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'

import { formatWon } from '@/lib/finance'

import type { AccountMonthlyData } from './account-monthly'
import {
  CHART_HEIGHT,
  CHART_TICK_FONT,
  CHART_TOOLTIP_FONT,
  resolveChartColor,
  useFinanceChartPalette,
} from './chart-js'
import { ChartLegendToggles } from './chart-primitives'
import { OTHER_SERIES_NAME, compactWon, seriesColor } from './chart-theme'

export function AccountMonthlyChart({ data }: { data: AccountMonthlyData }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const palette = useFinanceChartPalette()

  function toggle(account: string) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(account)) next.delete(account)
      else next.add(account)
      return next
    })
  }

  const chartData = useMemo<ChartData<'bar'>>(() => ({
    labels: Array.from({ length: 12 }, (_, month) => `${month + 1}월`),
    datasets: data.accounts.flatMap((account, index) => hidden.has(account) ? [] : [{
      label: account === OTHER_SERIES_NAME && data.folded?.length ? `${OTHER_SERIES_NAME} (${data.folded.join(', ')})` : account,
      data: data.series[account],
      backgroundColor: resolveChartColor(seriesColor(index, account), palette),
      borderColor: palette.background,
      borderWidth: 0.5,
      barPercentage: 0.72,
      categoryPercentage: 0.82,
    }]),
  }), [data, hidden, palette])
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
      x: { stacked: true, border: { display: false }, grid: { display: false }, ticks: { color: palette.muted, font: CHART_TICK_FONT, maxRotation: 0 } },
      y: { stacked: true, beginAtZero: true, border: { display: false }, grid: { color: palette.track, drawTicks: false }, ticks: { color: palette.faint, font: CHART_TICK_FONT, maxTicksLimit: 4, padding: 8, callback: (value) => compactWon(Number(value)) } },
    },
  }), [palette])

  return (
    <div>
      <ChartLegendToggles
        hidden={hidden}
        items={data.accounts.map((account, index) => ({ name: account, color: seriesColor(index, account) }))}
        label="결제수단 범례"
        onToggle={toggle}
      />
      <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
        <Bar aria-label="결제수단별 월간 금액 누적 막대 차트" data={chartData} options={options} role="img" />
      </div>
    </div>
  )
}
