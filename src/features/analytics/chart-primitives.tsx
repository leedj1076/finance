'use client'

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import { ChartTooltip, type ChartTooltipRow, type ChartTooltipState } from './chart-tooltip'
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

// Charts render at 1:1 pixels: the SVG is as wide as its container and the
// viewBox matches, so an 11px label is 11px in a half-width column and in a
// full-width one. Scaling a fixed viewBox to the container made the same
// chart look bold in one place and thin in another.
export const MIN_CHART_WIDTH = 620

export function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(Math.round(element.getBoundingClientRect().width))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

export function ChartPlaceholder({ height = HEIGHT }: { height?: number }) {
  return <div aria-hidden className="animate-pulse border-y border-finance-border bg-finance-panel" style={{ height }} />
}

export function plotWidthFor(width: number) {
  return width - LEFT - RIGHT
}

export function coordinates(values: Array<number | null>, maxValue: number, minValue = 0, width = WIDTH) {
  const plotWidth = plotWidthFor(width)
  const plotHeight = HEIGHT - TOP - BOTTOM
  const range = Math.max(maxValue - minValue, 1)
  const step = plotWidth / Math.max(values.length - 1, 1)
  return values.map((value, index) => ({
    x: LEFT + step * index,
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

// 1:1 rendering means pointer offsets are SVG coordinates already.
export function pointerPosition(event: ReactPointerEvent<SVGElement>) {
  const svg = event.currentTarget.ownerSVGElement ?? (event.currentTarget as unknown as SVGSVGElement)
  const bounds = svg.getBoundingClientRect()
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}

export function tooltipAt(
  event: ReactPointerEvent<SVGElement>,
  title: string,
  rows: ChartTooltipRow[],
) {
  return { ...pointerPosition(event), title, rows }
}

// Three horizontal hairlines with values on the left and month labels below.
export function Grid({ maxValue, minValue = 0, months, width = WIDTH, formatValue = compactWon }: {
  maxValue: number
  minValue?: number
  months?: string[]
  width?: number
  formatValue?: (value: number) => string
}) {
  const range = Math.max(maxValue - minValue, 1)
  const count = months?.length ?? 12
  const step = plotWidthFor(width) / Math.max(count - 1, 1)
  return (
    <g>
      {[0, 0.5, 1].map((ratio) => {
        const y = TOP + (HEIGHT - TOP - BOTTOM) * ratio
        const value = Math.round(maxValue - range * ratio)
        return (
          <g key={ratio}>
            <line stroke={ROLE.grid} x1={LEFT} x2={width - RIGHT} y1={y} y2={y} />
            <text className="chart-axis-label" fill={ROLE.faint} textAnchor="end" x={LEFT - 8} y={y + 3}>
              {formatValue(value)}
            </text>
          </g>
        )
      })}
      {Array.from({ length: count }, (_, index) => (
        <text className="chart-axis-label" fill={ROLE.muted} key={index} textAnchor="middle" x={LEFT + step * index} y={HEIGHT - 12}>
          {months?.[index] ?? `${index + 1}월`}
        </text>
      ))}
    </g>
  )
}

// Measures its container, renders the chart at that exact width, and hosts
// the shared tooltip. Children receive the measured width.
export function ChartFrame({
  children,
  height = HEIGHT,
  minWidth = MIN_CHART_WIDTH,
  onLeave,
  tooltip = null,
}: {
  children: (width: number) => ReactNode
  height?: number
  minWidth?: number
  onLeave?: () => void
  tooltip?: ChartTooltipState | null
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  return (
    <div className="relative" onPointerLeave={onLeave} ref={ref} style={{ minWidth }}>
      {width > 0 ? children(width) : <ChartPlaceholder height={height} />}
      {width > 0 && <ChartTooltip chartHeight={height} chartWidth={width} tooltip={tooltip} />}
    </div>
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
