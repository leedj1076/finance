'use client'

import { useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import type { ChartTooltipRow } from './chart-tooltip'
import {
  BOTTOM,
  HEIGHT,
  LEFT,
  RIGHT,
  ROLE,
  TOP,
  WIDTH,
  compactWon,
} from './chart-theme'

export * from './chart-theme'

const subscribe = () => () => undefined

export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false)
}

export function ChartPlaceholder({ height = HEIGHT }: { height?: number }) {
  return <div aria-hidden className="min-w-[620px] animate-pulse border-y border-finance-border bg-finance-panel" style={{ height }} />
}

export function coordinates(values: Array<number | null>, maxValue: number, minValue = 0) {
  const plotWidth = WIDTH - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  const range = Math.max(maxValue - minValue, 1)
  return values.map((value, index) => ({
    x: LEFT + (plotWidth * index) / 11,
    y: value === null ? null : TOP + plotHeight - ((value - minValue) / range) * plotHeight,
    value,
  }))
}

export function pathFor(points: ReturnType<typeof coordinates>) {
  let path = ''
  let drawing = false
  for (const point of points) {
    if (point.y === null) {
      drawing = false
      continue
    }
    path += `${drawing ? ' L' : ' M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    drawing = true
  }
  return path
}

export function pointerPosition(event: ReactPointerEvent<SVGElement>, width = WIDTH, height = HEIGHT) {
  const svg = event.currentTarget.ownerSVGElement
  if (!svg) return { x: 0, y: 0 }
  const bounds = svg.getBoundingClientRect()
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * width,
    y: ((event.clientY - bounds.top) / bounds.height) * height,
  }
}

export function tooltipAt(
  event: ReactPointerEvent<SVGElement>,
  title: string,
  rows: ChartTooltipRow[],
) {
  return { ...pointerPosition(event), title, rows }
}

// Three horizontal hairlines with values on the left and month labels below.
export function Grid({ maxValue, minValue = 0, months }: {
  maxValue: number
  minValue?: number
  months?: string[]
}) {
  const range = Math.max(maxValue - minValue, 1)
  return (
    <g>
      {[0, 0.5, 1].map((ratio) => {
        const y = TOP + (HEIGHT - TOP - BOTTOM) * ratio
        const value = Math.round(maxValue - range * ratio)
        return (
          <g key={ratio}>
            <line stroke={ROLE.grid} x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} />
            <text className="chart-axis-label" fill={ROLE.faint} textAnchor="end" x={LEFT - 8} y={y + 3}>
              {compactWon(value)}
            </text>
          </g>
        )
      })}
      {Array.from({ length: 12 }, (_, index) => {
        const x = LEFT + ((WIDTH - LEFT - RIGHT) * index) / 11
        return (
          <text className="chart-axis-label" fill={ROLE.muted} key={index} textAnchor="middle" x={x} y={HEIGHT - 12}>
            {months?.[index] ?? `${index + 1}월`}
          </text>
        )
      })}
    </g>
  )
}

export type LegendItem = { name: string; color: string }

// Static legend: swatch + name. For >= 2 series a legend is always present.
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-4 t-caption text-finance-muted">
      {items.map((item) => (
        <span className="flex items-center gap-1.5" key={item.name}>
          <span aria-hidden className="h-2.5 w-2.5" style={{ backgroundColor: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  )
}

// Toggle legend: chips that hide a series on click and highlight it on hover.
export function ChartLegendToggles({
  items,
  hidden,
  onToggle,
  onHover,
  renderExtra,
  label,
}: {
  items: LegendItem[]
  hidden: Set<string>
  onToggle: (name: string) => void
  onHover?: (name: string | null) => void
  renderExtra?: (name: string) => ReactNode
  label: string
}) {
  return (
    <div aria-label={label} className="mb-4 flex flex-wrap gap-2" role="group">
      {items.map((item) => {
        const visible = !hidden.has(item.name)
        return (
          <span className="inline-flex items-center gap-1" key={item.name}>
            <button
              aria-pressed={visible}
              className={`inline-flex h-[30px] items-center gap-1.5 border px-2.5 t-caption ${visible ? 'border-finance-border bg-white text-finance-ink' : 'border-finance-border bg-finance-track text-finance-faint line-through'}`}
              onBlur={() => onHover?.(null)}
              onClick={() => onToggle(item.name)}
              onFocus={() => visible && onHover?.(item.name)}
              onMouseEnter={() => visible && onHover?.(item.name)}
              onMouseLeave={() => onHover?.(null)}
              type="button"
            >
              <span aria-hidden className="h-2.5 w-2.5" style={{ backgroundColor: item.color }} />
              {item.name}
            </button>
            {renderExtra?.(item.name)}
          </span>
        )
      })}
    </div>
  )
}
