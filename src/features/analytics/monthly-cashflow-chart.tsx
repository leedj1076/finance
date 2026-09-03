'use client'

import { useState } from 'react'

import { formatWon } from '@/lib/finance'

import {
  BAR_PAIR_GAP,
  BAR_PAIR_WIDTH,
  BOTTOM,
  ChartFrame,
  ChartLegend,
  Grid,
  HEIGHT,
  LEFT,
  ROLE,
  TOP,
  monthLabel,
  plotWidthFor,
  tooltipAt,
} from './chart-primitives'
import type { ChartTooltipState } from './chart-tooltip'

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
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const incomeValues = data.map((item) => item.active ? item.income : null)
  const expenseValues = data.map((item) => item.active ? item.expense : null)
  const maxValue = Math.max(1, ...incomeValues.filter((value): value is number => value !== null), ...expenseValues.filter((value): value is number => value !== null))
  const plotHeight = HEIGHT - TOP - BOTTOM
  const months = data.map((item, index) => monthLabel(item.month, index))

  return (
    <div>
      <ChartLegend items={LEGEND} />
      <ChartFrame onLeave={() => setTooltip(null)} tooltip={tooltip}>
        {(width) => {
          const step = plotWidthFor(width) / Math.max(data.length - 1, 1)
          return (
            <svg aria-label="월별 수입과 지출 막대 차트" height={HEIGHT} role="img" viewBox={`0 0 ${width} ${HEIGHT}`} width={width}>
              <Grid maxValue={maxValue} months={months} width={width} />
              {data.map((item, index) => {
                if (!item.active) return null
                const center = LEFT + step * index
                return ([
                  { color: ROLE.income, label: '수입', value: item.income, x: center - BAR_PAIR_WIDTH - BAR_PAIR_GAP / 2 },
                  { color: ROLE.expense, label: '지출', value: item.expense, x: center + BAR_PAIR_GAP / 2 },
                ]).map((bar) => {
                  const barHeight = (bar.value / maxValue) * plotHeight
                  const rows = [{ color: bar.color, label: bar.label, value: bar.value }]
                  return (
                    <rect
                      aria-label={`${months[index]} ${bar.label} ${formatWon(bar.value)}원`}
                      className="chart-bar-enter"
                      fill={bar.color}
                      height={barHeight}
                      key={`${bar.label}-${index}`}
                      onPointerEnter={(event) => setTooltip(tooltipAt(event, months[index], rows))}
                      onPointerMove={(event) => setTooltip(tooltipAt(event, months[index], rows))}
                      width={BAR_PAIR_WIDTH}
                      x={bar.x}
                      y={TOP + plotHeight - barHeight}
                      style={{ animationDelay: `${index * 35}ms` }}
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
