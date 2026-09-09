export type ChartHoverAnchor = {
  x: number
  y: number
  plot: { left: number; right: number; top: number; bottom: number }
}

/** Viewport coordinates: prefer outside the plot, then the side away from the pointer. */
export function chartTooltipPosition(
  anchor: ChartHoverAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const margin = 8
  const gap = 12
  const clampX = (x: number) => Math.max(margin, Math.min(x, viewport.width - size.width - margin))
  const clampY = (y: number) => Math.max(margin, Math.min(y, viewport.height - size.height - margin))
  const left = clampX(anchor.x + gap)
  const outside = [
    { left, top: anchor.plot.top - size.height - gap },
    { left, top: anchor.plot.bottom + gap },
    { left: anchor.plot.left - size.width - gap, top: clampY(anchor.y - size.height / 2) },
    { left: anchor.plot.right + gap, top: clampY(anchor.y - size.height / 2) },
  ].filter(point => point.left >= margin && point.top >= margin
    && point.left + size.width <= viewport.width - margin
    && point.top + size.height <= viewport.height - margin)
  const distance = (point: { left: number; top: number }) => Math.hypot(
    point.left + size.width / 2 - anchor.x, point.top + size.height / 2 - anchor.y,
  )
  if (outside.length) return outside.sort((a, b) => distance(a) - distance(b))[0]

  const above = anchor.y - size.height - gap
  const below = anchor.y + gap
  if (above >= margin) return { left, top: above }
  if (below + size.height <= viewport.height - margin) return { left, top: below }
  // Very short viewports: keep as much of the hovered mark clear as possible.
  return [
    { left: margin, top: margin },
    { left: clampX(viewport.width), top: margin },
    { left: margin, top: clampY(viewport.height) },
    { left: clampX(viewport.width), top: clampY(viewport.height) },
  ].sort((a, b) => distance(b) - distance(a))[0]
}
