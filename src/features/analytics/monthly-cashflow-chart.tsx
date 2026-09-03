'use client'

import { useState } from 'react'

import { formatWon } from '@/lib/finance'

import {
  BAR_PAIR_GAP,
  BAR_PAIR_WIDTH,
  BOTTOM,
  ChartLegend,
  ChartPlaceholder,
  Grid,
  HEIGHT,
  LEFT,
  RIGHT,
  ROLE,
  TOP,
  WIDTH,
  monthLabel,
  tooltipAt,
  useHydrated,
} from './chart-primitives'
import { ChartTooltip, type ChartTooltipState } from './chart-tooltip'

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
  const hydrated = useHydrated()
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const incomeValues = data.map((item) => item.active ? item.income : null)
  const expenseValues = data.map((item) => item.active ? item.expense : null)
  const maxValue = Math.max(1, ...incomeValues.filter((value): value is number => value !== null), ...expenseValues.filter((value): value is number => value !== null))
  const plotHeight = HEIGHT - TOP - BOTTOM
  const plotWidth = WIDTH - LEFT - RIGHT
  const barWidth = BAR_PAIR_WIDTH
  const barGap = BAR_PAIR_GAP

  if (!hydrated) return <ChartPlaceholder />

  return (
    <div>
      <ChartLegend items={LEGEND} />
      <div className="relative min-w-[620px]" onPointerLeave={() => setTooltip(null)}>
        <svg
          aria-label="월별 수입과 지출 막대 차트"
          className="h-auto w-full"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <Grid maxValue={maxValue} />
          {data.map((item, index) => {
            if (!item.active) return null
            const center = LEFT + (plotWidth * index) / 11
            const displayMonth = monthLabel(item.month, index)
            return ([
              { color: ROLE.income, label: '수입', value: item.income, x: center - barWidth - barGap / 2 },
              { color: ROLE.expense, label: '지출', value: item.expense, x: center + barGap / 2 },
            ]).map((bar) => {
              const height = (bar.value / maxValue) * plotHeight
              return (
                <rect
                  aria-label={`${displayMonth} ${bar.label} ${formatWon(bar.value)}원`}
                  className="chart-bar-enter"
                  fill={bar.color}
                  height={height}
                  key={`${bar.label}-${index}`}
                  onPointerEnter={(event) => setTooltip(tooltipAt(event, displayMonth, [{ color: bar.color, label: bar.label, value: bar.value }]))}
                  onPointerMove={(event) => setTooltip(tooltipAt(event, displayMonth, [{ color: bar.color, label: bar.label, value: bar.value }]))}
                  rx="0"
                  width={barWidth}
                  x={bar.x}
                  y={TOP + plotHeight - height}
                  style={{ animationDelay: `${index * 35}ms` }}
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
