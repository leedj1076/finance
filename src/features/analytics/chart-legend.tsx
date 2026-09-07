'use client'

import type { ReactNode } from 'react'

// Chart.js draws the plots; the legends are ours because they double as the
// series toggles and have to match the app's chip styling.

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
