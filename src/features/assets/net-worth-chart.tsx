'use client'

import { useState, type PointerEvent as ReactPointerEvent } from 'react'

import {
  BOTTOM,
  ChartFrame,
  ChartLegend,
  Grid,
  HEIGHT,
  LEFT,
  LINE_WIDTH,
  LINE_WIDTH_SECONDARY,
  POINT_RADIUS,
  POINT_RADIUS_ACTIVE,
  ROLE,
  TOP,
  coordinates,
  monthLabel,
  pathFor,
  plotWidthFor,
  pointerPosition,
  xAt,
} from '@/features/analytics/chart-primitives'
import type { ChartTooltipState } from '@/features/analytics/chart-tooltip'

type TrendPoint = {
  month: string
  assets: number
  debt: number
  netWorth: number
  active: boolean
}

// 순자산이 주인공, 총자산은 보조(점선), 부채는 역할색 red.
const SERIES = [
  { key: 'netWorth' as const, label: '순자산', color: ROLE.saving, width: LINE_WIDTH, dash: undefined, radius: POINT_RADIUS_ACTIVE },
  { key: 'assets' as const, label: '총자산', color: ROLE.faint, width: LINE_WIDTH_SECONDARY, dash: '4 3', radius: POINT_RADIUS },
  { key: 'debt' as const, label: '부채', color: ROLE.over, width: LINE_WIDTH_SECONDARY, dash: undefined, radius: POINT_RADIUS },
]

export function NetWorthChart({ data }: { data: TrendPoint[] }) {
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const activeValues = data
    .filter((point) => point.active)
    .flatMap((point) => [point.assets, point.debt, point.netWorth])
  const minValue = Math.min(0, ...activeValues)
  const maxValue = Math.max(1, ...activeValues)
  const plotHeight = HEIGHT - TOP - BOTTOM
  const months = data.map((point, index) => monthLabel(point.month, index))

  function showTooltip(event: ReactPointerEvent<SVGElement>, index: number) {
    setTooltip({
      ...pointerPosition(event),
      title: months[index],
      rows: SERIES.map((item) => ({ color: item.color, label: item.label, value: data[index][item.key] })),
    })
  }

  return (
    <div>
      <ChartLegend items={SERIES.map((item) => ({ name: item.label, color: item.color }))} />
      <ChartFrame onLeave={() => setTooltip(null)} tooltip={tooltip}>
        {(width) => {
          const hitWidth = plotWidthFor(width) / Math.max(data.length, 1)
          return (
            <svg aria-label="월별 순자산 추이" height={HEIGHT} role="img" viewBox={`0 0 ${width} ${HEIGHT}`} width={width}>
              <Grid maxValue={maxValue} minValue={minValue} months={months} width={width} />
              {SERIES.map((item) => {
                const rows = coordinates(data.map((point) => point.active ? point[item.key] : null), maxValue, minValue, width)
                return (
                  <g key={item.key}>
                    <path
                      className="chart-line-enter"
                      d={pathFor(rows)}
                      fill="none"
                      pathLength={1}
                      stroke={item.color}
                      strokeDasharray={item.dash}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={item.width}
                    />
                    {rows.map((point, index) => point.y === null ? null : (
                      <circle className="chart-point-enter" cx={point.x} cy={point.y} fill={item.color} key={index} pointerEvents="none" r={item.radius} style={{ animationDelay: `${180 + index * 35}ms` }} />
                    ))}
                  </g>
                )
              })}
              {data.map((point, index) => !point.active ? null : (
                <rect
                  aria-label={`${months[index]} 자산 요약`}
                  fill="transparent"
                  height={plotHeight}
                  key={`hit-${point.month}`}
                  onPointerEnter={(event) => showTooltip(event, index)}
                  onPointerMove={(event) => showTooltip(event, index)}
                  width={hitWidth}
                  x={Math.max(LEFT, xAt(index, data.length, width) - hitWidth / 2)}
                  y={TOP}
                />
              ))}
            </svg>
          )
        }}
      </ChartFrame>
    </div>
  )
}
