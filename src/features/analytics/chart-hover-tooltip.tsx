'use client'

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { chartTooltipPosition, type ChartHoverAnchor } from './chart-tooltip-position'

export function ChartHoverTooltip({ anchor, children }: { anchor: ChartHoverAnchor; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const position = chartTooltipPosition(anchor, element.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight })
    element.style.left = `${position.left}px`
    element.style.top = `${position.top}px`
    element.style.visibility = 'visible'
  }, [anchor, children])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={ref} role="tooltip" aria-label="월별 차트 상세"
      className="pointer-events-none fixed z-50 w-max max-w-[calc(100vw-16px)] bg-finance-ink px-3 py-2.5 text-[var(--background)] shadow-xl"
      style={{ left: 0, top: 0, visibility: 'hidden' }}>
      {children}
    </div>, document.body,
  )
}
