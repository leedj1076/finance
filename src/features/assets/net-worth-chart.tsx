'use client'

import { useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'

import { ChartTooltip, type ChartTooltipState } from '@/features/analytics/chart-tooltip'
import { formatWon } from '@/lib/finance'

type TrendPoint = {
  month: string
  assets: number
  debt: number
  netWorth: number
  active: boolean
}

const WIDTH = 760
const HEIGHT = 260
const LEFT = 62
const RIGHT = 18
const TOP = 18
const BOTTOM = 38
const subscribe = () => () => undefined

function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false)
}

function compactWon(value: number) {
  const absolute = Math.abs(value)
  if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`
  if (absolute >= 10_000) return `${Math.round(value / 10_000)}만`
  return formatWon(value)
}

function monthLabel(month: string, fallbackIndex: number) {
  const match = month.match(/(?:^|-)0?(\d{1,2})$/)
  return match ? `${Number(match[1])}월` : (month || `${fallbackIndex + 1}월`)
}

export function NetWorthChart({ data }: { data: TrendPoint[] }) {
  const hydrated = useHydrated()
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const activeValues = data
    .filter((point) => point.active)
    .flatMap((point) => [point.assets, point.debt, point.netWorth])
  const minValue = Math.min(0, ...activeValues)
  const maxValue = Math.max(1, ...activeValues)
  const range = Math.max(maxValue - minValue, 1)
  const plotWidth = WIDTH - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  const yFor = (value: number) => TOP + plotHeight - ((value - minValue) / range) * plotHeight
  const points = (key: 'assets' | 'debt' | 'netWorth') => data.map((point, index) => ({
    x: LEFT + (plotWidth * index) / 11,
    y: point.active ? yFor(point[key]) : null,
    value: point[key],
  }))
  const pathFor = (rows: ReturnType<typeof points>) => {
    let path = ''
    let drawing = false
    for (const point of rows) {
      if (point.y === null) {
        drawing = false
        continue
      }
      path += `${drawing ? ' L' : ' M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
      drawing = true
    }
    return path
  }

  if (!hydrated) {
    return <div aria-hidden className="h-[260px] min-w-[620px] animate-pulse border-y border-finance-hairline bg-finance-panel" />
  }

  const series = [
    { key: 'netWorth' as const, label: '순자산', color: 'var(--finance-green)', width: 3 },
    { key: 'assets' as const, label: '총자산', color: 'var(--finance-blue)', width: 2 },
    { key: 'debt' as const, label: '부채', color: 'var(--finance-red)', width: 2 },
  ]
  const hitWidth = plotWidth / 12

  function showTooltip(event: ReactPointerEvent<SVGElement>, index: number) {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const bounds = svg.getBoundingClientRect()
    setTooltip({
      title: monthLabel(data[index].month, index),
      rows: series.map((item) => ({
        color: item.color,
        label: item.label,
        value: data[index][item.key],
      })),
      x: ((event.clientX - bounds.left) / bounds.width) * WIDTH,
      y: ((event.clientY - bounds.top) / bounds.height) * HEIGHT,
    })
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-finance-muted">
        {series.map((item) => (
          <span className="flex items-center gap-1.5" key={item.key}>
            <span className="h-2.5 w-2.5" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <div className="relative min-w-[620px]" onPointerLeave={() => setTooltip(null)}>
        <svg
          aria-label="월별 순자산 추이"
          className="h-auto w-full"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
        {[0, 0.5, 1].map((ratio) => {
          const y = TOP + plotHeight * ratio
          const value = maxValue - range * ratio
          return (
            <g key={ratio}>
              <line stroke="var(--finance-border)" x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} />
              <text fill="var(--finance-faint)" fontSize="10" textAnchor="end" x={LEFT - 8} y={y + 3}>
                {compactWon(value)}
              </text>
            </g>
          )
        })}
        {data.map((point, index) => (
          <text
            fill="var(--finance-muted)"
            fontSize="10"
            key={point.month}
            textAnchor="middle"
            x={LEFT + (plotWidth * index) / 11}
            y={HEIGHT - 12}
          >
            {index + 1}월
          </text>
        ))}
          {series.map((item) => {
            const rows = points(item.key)
            return (
              <g key={item.key}>
                <path
                  className="chart-line-enter"
                  d={pathFor(rows)}
                  fill="none"
                  pathLength={1}
                  stroke={item.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={item.width}
                />
                {rows.map((point, index) => point.y === null ? null : (
                  <circle className="chart-point-enter" cx={point.x} cy={point.y} fill={item.color} key={index} pointerEvents="none" r={item.key === 'netWorth' ? 4 : 3} style={{ animationDelay: `${180 + index * 35}ms` }} />
                ))}
              </g>
            )
          })}
          {data.map((point, index) => !point.active ? null : (
            <rect
              aria-label={`${monthLabel(point.month, index)} 자산 요약`}
              fill="transparent"
              height={plotHeight}
              key={`hit-${point.month}`}
              onPointerEnter={(event) => showTooltip(event, index)}
              onPointerMove={(event) => showTooltip(event, index)}
              width={hitWidth}
              x={Math.max(LEFT, LEFT + (plotWidth * index) / 11 - hitWidth / 2)}
              y={TOP}
            />
          ))}
        </svg>
        <ChartTooltip chartHeight={HEIGHT} chartWidth={WIDTH} tooltip={tooltip} />
      </div>
    </div>
  )
}
