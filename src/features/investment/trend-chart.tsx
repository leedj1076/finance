'use client'

import { Line } from 'react-chartjs-2'

import { CHART_ANIMATIONS, CHART_HEIGHT, CHART_LINE_WIDTH, financeScales, financeTooltip, useFinanceChartPalette } from '@/features/analytics/chart-js'

import { formatMoney } from './format'
import type { Market } from './types'

export function TrendChart({ points, scope, priceChart = false }: { points: Array<{ date: string; value: number; cost: number | null }>; scope: 'total' | Market; priceChart?: boolean }) {
  const palette = useFinanceChartPalette()
  const currency = scope === 'US' ? 'USD' : 'KRW'
  const compact = (value: number) => Math.abs(value) < (currency === 'USD' ? 1000 : 1e6) ? formatMoney(value, currency) : currency === 'USD' ? `$${(value / 1000).toFixed(1)}k` : `${(value / 1e6).toFixed(1)}M`
  return (
    <div style={{ height: CHART_HEIGHT }}>
      <Line
        aria-label={priceChart ? '최근 3개월 종가와 평균단가' : '평가금액과 투입원금 추이'}
        role="img"
        data={{
          labels: points.map((p) => p.date),
          datasets: [
            { label: priceChart ? '종가' : '평가금액', data: points.map((p) => p.value), borderColor: palette.series[0], backgroundColor: palette.series[0], borderWidth: CHART_LINE_WIDTH, pointRadius: points.length === 1 ? 3 : 0, tension: 0 },
            { label: priceChart ? '평균단가' : '투입원금', data: points.map((p) => p.cost), borderColor: palette.series[1], backgroundColor: palette.series[1], borderWidth: CHART_LINE_WIDTH, borderDash: priceChart ? [4, 3] : [], pointRadius: points.length === 1 ? 3 : 0, tension: 0 },
          ],
        }}
        options={{
          responsive: true, maintainAspectRatio: false, animations: CHART_ANIMATIONS,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { ...financeTooltip(palette), callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMoney(Number(ctx.raw ?? 0), currency)}${currency === 'KRW' ? '원' : ''}` } },
          },
          scales: financeScales(palette, { beginAtZero: false, format: compact, showMonths: true }),
        }}
      />
    </div>
  )
}
