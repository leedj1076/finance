'use client'

import { useState } from 'react'

import { formatWon } from '@/lib/finance'

import type { AccountMonthlyData } from './account-monthly'
import {
  BAR_STACK_WIDTH,
  BOTTOM,
  ChartFrame,
  ChartLegendToggles,
  Grid,
  HEIGHT,
  OTHER_SERIES_NAME,
  TOP,
  seriesColor,
  tooltipAt,
  xAt,
} from './chart-primitives'
import type { ChartTooltipState } from './chart-tooltip'

export function AccountMonthlyChart({ data }: { data: AccountMonthlyData }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const visibleAccounts = data.accounts.filter((account) => !hidden.has(account))
  const monthTotals = Array.from({ length: 12 }, (_, index) => data.accounts.reduce(
    (sum, account) => sum + (hidden.has(account) ? 0 : (data.series[account][index] ?? 0)),
    0,
  ))
  const maxValue = Math.max(1, ...monthTotals)
  const plotHeight = HEIGHT - TOP - BOTTOM

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
      <ChartFrame onLeave={() => setTooltip(null)} tooltip={tooltip}>
        {(width) => {
          return (
            <svg aria-label="결제수단별 월간 금액 누적 막대 차트" height={HEIGHT} role="img" viewBox={`0 0 ${width} ${HEIGHT}`} width={width}>
              <Grid maxValue={maxValue} width={width} />
              {Array.from({ length: 12 }, (_, monthIndex) => {
                let cumulative = 0
                return visibleAccounts.map((account) => {
                  const accountIndex = data.accounts.indexOf(account)
                  const value = data.series[account][monthIndex]
                  if (value === null || value <= 0) return null
                  const previous = cumulative
                  cumulative += value
                  const x = xAt(monthIndex, 12, width) - BAR_STACK_WIDTH / 2
                  const y = TOP + plotHeight - (cumulative / maxValue) * plotHeight
                  const barHeight = ((cumulative - previous) / maxValue) * plotHeight
                  const color = seriesColor(accountIndex, account)
                  const label = account === OTHER_SERIES_NAME && data.folded?.length
                    ? `${OTHER_SERIES_NAME} (${data.folded.join(', ')})`
                    : account
                  const rows = [{ color, label, value }]
                  return (
                    <rect
                      aria-label={`${monthIndex + 1}월 ${account} ${formatWon(value)}원`}
                      className="chart-bar-enter"
                      fill={color}
                      height={barHeight}
                      key={`${account}-${monthIndex}`}
                      onPointerEnter={(event) => setTooltip(tooltipAt(event, `${monthIndex + 1}월`, rows))}
                      onPointerMove={(event) => setTooltip(tooltipAt(event, `${monthIndex + 1}월`, rows))}
                      width={BAR_STACK_WIDTH}
                      x={x}
                      y={y}
                      style={{ animationDelay: `${monthIndex * 35}ms` }}
                    />
                  )
                })
              })}
            </svg>
          )
        }}
      </ChartFrame>
    </div>
  )
}
