'use client'

import type { ChartData, ChartOptions } from 'chart.js'
import { useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'

import type { AccountMonthlyData } from './account-monthly'
import {
  CHART_ANIMATION,
  CHART_HEIGHT,
  financeScales,
  financeTooltip,
  resolveChartColor,
  useFinanceChartPalette,
  wonTooltipLabel,
} from './chart-js'
import { ChartLegendToggles } from './chart-legend'
import { OTHER_SERIES_NAME, seriesColor } from './chart-theme'

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
    animation: CHART_ANIMATION,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { ...financeTooltip(palette), callbacks: { label: wonTooltipLabel } },
    },
    scales: financeScales(palette, { stacked: true }),
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
