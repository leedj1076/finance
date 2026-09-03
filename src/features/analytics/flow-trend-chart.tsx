'use client'

import { useState } from 'react'

import { formatWon } from '@/lib/finance'

import {
  BOTTOM,
  ChartPlaceholder,
  Grid,
  HEIGHT,
  LEFT,
  LINE_WIDTH,
  POINT_RADIUS,
  RIGHT,
  ROLE,
  TOP,
  WIDTH,
  coordinates,
  monthLabel,
  pathFor,
  tooltipAt,
  useHydrated,
} from './chart-primitives'
import { ChartTooltip, type ChartTooltipState } from './chart-tooltip'

type TrendPoint = {
  month: string
  amount: number
  active: boolean
}

export function FlowTrendChart({ data, label, tone }: { data: TrendPoint[]; label: string; tone: 'blue' | 'emerald' | 'rose' }) {
  const hydrated = useHydrated()
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const values = data.map((item) => item.active ? item.amount : null)
  const maxValue = Math.max(1, ...values.filter((value): value is number => value !== null))
  const points = coordinates(values, maxValue)
  const color = tone === 'blue' ? ROLE.income : tone === 'emerald' ? ROLE.saving : ROLE.over

  if (!hydrated) return <ChartPlaceholder />

  const hitWidth = (WIDTH - LEFT - RIGHT) / 12

  return (
    <div className="relative min-w-[620px]" onPointerLeave={() => setTooltip(null)}>
      <svg
        aria-label={`월별 ${label} 추이`}
        className="h-auto w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <Grid maxValue={maxValue} />
        <path className="chart-line-enter" d={pathFor(points)} fill="none" pathLength={1} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={LINE_WIDTH} />
        {points.map((point, index) => point.y === null ? null : (
          <circle className="chart-point-enter" cx={point.x} cy={point.y} fill={color} key={index} pointerEvents="none" r={POINT_RADIUS} style={{ animationDelay: `${180 + index * 35}ms` }} />
        ))}
        {points.map((point, index) => point.y === null ? null : (
          <rect
            aria-label={`${monthLabel(data[index].month, index)} ${label} ${formatWon(point.value ?? 0)}원`}
            fill="transparent"
            height={HEIGHT - TOP - BOTTOM}
            key={`hit-${index}`}
            onPointerEnter={(event) => setTooltip(tooltipAt(event, monthLabel(data[index].month, index), [{ color, label, value: point.value ?? 0 }]))}
            onPointerMove={(event) => setTooltip(tooltipAt(event, monthLabel(data[index].month, index), [{ color, label, value: point.value ?? 0 }]))}
            width={hitWidth}
            x={Math.max(LEFT, point.x - hitWidth / 2)}
            y={TOP}
          />
        ))}
      </svg>
      <ChartTooltip chartHeight={HEIGHT} chartWidth={WIDTH} tooltip={tooltip} />
    </div>
  )
}
