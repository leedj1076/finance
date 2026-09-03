'use client'

import { formatWon } from '@/lib/finance'

export type ChartTooltipRow = {
  color: string
  label: string
  separator?: string
  value: number
  suffix?: string
}

export type ChartTooltipState = {
  title: string
  rows: ChartTooltipRow[]
  x: number
  y: number
}

export function ChartTooltip({
  chartHeight,
  chartWidth,
  tooltip,
}: {
  chartHeight: number
  chartWidth: number
  tooltip: ChartTooltipState | null
}) {
  if (!tooltip) return null

  const placeOnLeft = tooltip.x > chartWidth * 0.64
  const top = tooltip.rows.length > 4
    ? 50
    : Math.min(82, Math.max(18, (tooltip.y / chartHeight) * 100))

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute z-20 min-w-36 border border-finance-ink bg-finance-ink px-3 py-2.5 text-white shadow-xl"
      role="tooltip"
      style={{
        left: `${(tooltip.x / chartWidth) * 100}%`,
        top: `${top}%`,
        transform: placeOnLeft
          ? 'translate(calc(-100% - 12px), -50%)'
          : 'translate(12px, -50%)',
      }}
    >
      <span
        aria-hidden
        className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 bg-finance-ink ${placeOnLeft ? '-right-1' : '-left-1'}`}
      />
      <p className="mb-1.5 whitespace-nowrap t-body-strong">{tooltip.title}</p>
      <div className="space-y-1">
        {tooltip.rows.map((row) => (
          <div className="flex items-center gap-2 whitespace-nowrap t-caption" key={`${row.label}-${row.value}`}>
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 border border-white/70"
              style={{ backgroundColor: row.color }}
            />
            <span>{row.label}{row.separator ?? ': '}<span className="tabular-nums">{formatWon(row.value)}{row.suffix ?? '원'}</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}
