'use client'

import { useState } from 'react'

import { formatWon } from '@/lib/finance'

import type { AccountMonthlyData } from './account-monthly'
import {
  BAR_STACK_WIDTH,
  BOTTOM,
  ChartLegendToggles,
  ChartPlaceholder,
  Grid,
  HEIGHT,
  LEFT,
  OTHER_SERIES_NAME,
  RIGHT,
  TOP,
  WIDTH,
  seriesColor,
  tooltipAt,
  useHydrated,
} from './chart-primitives'
import { ChartTooltip, type ChartTooltipState } from './chart-tooltip'

export function AccountMonthlyChart({ data }: { data: AccountMonthlyData }) {
  const hydrated = useHydrated()
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const visibleAccounts = data.accounts.filter((account) => !hidden.has(account))
  const monthTotals = Array.from({ length: 12 }, (_, index) => data.accounts.reduce(
    (sum, account) => sum + (hidden.has(account) ? 0 : (data.series[account][index] ?? 0)),
    0,
  ))
  const maxValue = Math.max(1, ...monthTotals)
  const plotHeight = HEIGHT - TOP - BOTTOM
  const plotWidth = WIDTH - LEFT - RIGHT
  const barWidth = BAR_STACK_WIDTH

  if (!hydrated) return <ChartPlaceholder />

  function toggle(account: string) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(account)) next.delete(account)
      else next.add(account)
      return next
    })
    setTooltip(null)
  }

  return (
    <div>
      <ChartLegendToggles
        hidden={hidden}
        items={data.accounts.map((account, index) => ({ name: account, color: seriesColor(index, account) }))}
        label="결제수단 범례"
        onToggle={toggle}
      />
      <div className="relative min-w-[620px]" onPointerLeave={() => setTooltip(null)}>
        <svg
          aria-label="결제수단별 월간 금액 누적 막대 차트"
          className="h-auto w-full"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <Grid maxValue={maxValue} />
          {Array.from({ length: 12 }, (_, monthIndex) => {
            let cumulative = 0
            return visibleAccounts.map((account) => {
              const accountIndex = data.accounts.indexOf(account)
              const value = data.series[account][monthIndex]
              if (value === null || value <= 0) return null
              const previous = cumulative
              cumulative += value
              const x = LEFT + (plotWidth * monthIndex) / 11 - barWidth / 2
              const y = TOP + plotHeight - (cumulative / maxValue) * plotHeight
              const height = ((cumulative - previous) / maxValue) * plotHeight
              const color = seriesColor(accountIndex, account)
              const label = account === OTHER_SERIES_NAME && data.folded?.length
                ? `${OTHER_SERIES_NAME} (${data.folded.join(', ')})`
                : account
              return (
                <rect
                  aria-label={`${monthIndex + 1}월 ${account} ${formatWon(value)}원`}
                  className="chart-bar-enter"
                  fill={color}
                  height={height}
                  key={`${account}-${monthIndex}`}
                  onPointerEnter={(event) => setTooltip(tooltipAt(event, `${monthIndex + 1}월`, [{ color, label, value }]))}
                  onPointerMove={(event) => setTooltip(tooltipAt(event, `${monthIndex + 1}월`, [{ color, label, value }]))}
                  rx="0"
                  width={barWidth}
                  x={x}
                  y={y}
                  style={{ animationDelay: `${monthIndex * 35}ms` }}
                />
              )
            })
          })}
        </svg>
        <ChartTooltip chartHeight={HEIGHT} chartWidth={WIDTH} tooltip={tooltip} />
      </div>
    </div>
  )
}
