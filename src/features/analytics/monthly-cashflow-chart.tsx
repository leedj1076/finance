'use client'

import { useState } from 'react'

import { formatWon } from '@/lib/finance'

import {
  BOTTOM,
  ChartPlaceholder,
  Grid,
  HEIGHT,
  LEFT,
  RIGHT,
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

export function MonthlyCashflowChart({ data }: { data: MonthlyCashflow[] }) {
  const hydrated = useHydrated()
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const incomeValues = data.map((item) => item.active ? item.income : null)
  const expenseValues = data.map((item) => item.active ? item.expense : null)
  const maxValue = Math.max(1, ...incomeValues.filter((value): value is number => value !== null), ...expenseValues.filter((value): value is number => value !== null))
  const plotHeight = HEIGHT - TOP - BOTTOM
  const plotWidth = WIDTH - LEFT - RIGHT
  const barWidth = 17
  const barGap = 3

  if (!hydrated) return <ChartPlaceholder />

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />수입</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-600" />지출</span>
      </div>
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
              { color: '#2563eb', label: '수입', value: item.income, x: center - barWidth - barGap / 2 },
              { color: '#e11d48', label: '지출', value: item.expense, x: center + barGap / 2 },
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
                  rx="3"
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

