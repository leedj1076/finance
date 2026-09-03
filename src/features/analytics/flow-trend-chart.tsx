'use client'

import { useState } from 'react'

import { formatWon } from '@/lib/finance'

import {
  BOTTOM,
  ChartFrame,
  Grid,
  HEIGHT,
  LEFT,
  LINE_WIDTH,
  POINT_RADIUS,
  ROLE,
  TOP,
  coordinates,
  monthLabel,
  pathFor,
  plotWidthFor,
  tooltipAt,
} from './chart-primitives'
import type { ChartTooltipState } from './chart-tooltip'

type TrendPoint = {
  month: string
  amount: number
  active: boolean
}

export function FlowTrendChart({ data, label, tone }: { data: TrendPoint[]; label: string; tone: 'blue' | 'emerald' | 'rose' }) {
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const values = data.map((item) => item.active ? item.amount : null)
  const maxValue = Math.max(1, ...values.filter((value): value is number => value !== null))
  const color = tone === 'blue' ? ROLE.income : tone === 'emerald' ? ROLE.saving : ROLE.over
  const months = data.map((item, index) => monthLabel(item.month, index))

  return (
    <ChartFrame onLeave={() => setTooltip(null)} tooltip={tooltip}>
      {(width) => {
        const points = coordinates(values, maxValue, 0, width)
        const hitWidth = plotWidthFor(width) / Math.max(data.length, 1)
        return (
          <svg aria-label={`월별 ${label} 추이`} height={HEIGHT} role="img" viewBox={`0 0 ${width} ${HEIGHT}`} width={width}>
            <Grid maxValue={maxValue} months={months} width={width} />
            <path className="chart-line-enter" d={pathFor(points)} fill="none" pathLength={1} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={LINE_WIDTH} />
            {points.map((point, index) => point.y === null ? null : (
              <circle className="chart-point-enter" cx={point.x} cy={point.y} fill={color} key={index} pointerEvents="none" r={POINT_RADIUS} style={{ animationDelay: `${180 + index * 35}ms` }} />
            ))}
            {points.map((point, index) => point.y === null ? null : (
              <rect
                aria-label={`${months[index]} ${label} ${formatWon(point.value ?? 0)}원`}
                fill="transparent"
                height={HEIGHT - TOP - BOTTOM}
                key={`hit-${index}`}
                onPointerEnter={(event) => setTooltip(tooltipAt(event, months[index], [{ color, label, value: point.value ?? 0 }]))}
                onPointerMove={(event) => setTooltip(tooltipAt(event, months[index], [{ color, label, value: point.value ?? 0 }]))}
                width={hitWidth}
                x={Math.max(LEFT, point.x - hitWidth / 2)}
                y={TOP}
              />
            ))}
          </svg>
        )
      }}
    </ChartFrame>
  )
}
