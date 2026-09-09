import { expect, test } from 'vitest'
import { chartTooltipPosition } from '@/features/analytics/chart-tooltip-position'

const plot = { left: 100, right: 900, top: 200, bottom: 420 }
const viewport = { width: 1000, height: 700 }
const size = { width: 300, height: 100 }

test('keeps chart tooltips outside the plot and follows the hovered column', () => {
  const first = chartTooltipPosition({ x: 150, y: 210, plot }, size, viewport)
  const next = chartTooltipPosition({ x: 650, y: 210, plot }, size, viewport)
  expect(first.top + size.height).toBeLessThan(plot.top)
  expect(next.top + size.height).toBeLessThan(plot.top)
  expect(next.left - first.left).toBe(500)
  const lower = chartTooltipPosition({ x: 650, y: 400, plot }, size, viewport)
  expect(lower.top).toBeGreaterThan(plot.bottom)
})

test('uses space below a plot scrolled to the top rather than covering the hovered area', () => {
  const result = chartTooltipPosition({ x: 600, y: 30, plot: { ...plot, top: 10, bottom: 230 } }, size, viewport)
  expect(result.top).toBeGreaterThan(230)
})

test('clamps to narrow viewports and avoids the cursor even when neither outside edge fits', () => {
  const result = chartTooltipPosition({ x: 360, y: 150, plot: { left: -150, right: 1000, top: 30, bottom: 250 } }, size, { width: 390, height: 280 })
  expect(result.left).toBeGreaterThanOrEqual(8)
  expect(result.left + size.width).toBeLessThanOrEqual(382)
  expect(result.top).toBeGreaterThanOrEqual(8)
  expect(result.top + size.height).toBeLessThan(150)
})
