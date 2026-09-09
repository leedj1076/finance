import type { Chart, ChartEvent } from 'chart.js'
import { expect, test, vi } from 'vitest'
import { monthlyEligibilityBoundary } from '@/features/analytics/chart-js'

function chartFixture() {
  return {
    data: { datasets: [{ data: [400, null, 200, 0] }] },
    scales: { x: { getValueForPixel: (x: number) => x } },
    setActiveElements: vi.fn(),
    tooltip: { setActiveElements: vi.fn() },
    draw: vi.fn(),
  }
}

test('one mounted eligibility plugin follows refreshed datasets, including newly closed zero and reopened slots', () => {
  const chart = chartFixture()
  const plugin = monthlyEligibilityBoundary()
  const event: ChartEvent = { type: 'mousemove', x: 1, y: 20, native: null }
  const dispatch = () => plugin.beforeEvent!(chart as unknown as Chart, { event, inChartArea: true, replay: false, cancelable: true }, {})
  expect(dispatch()).toBe(false)
  expect(chart.tooltip.setActiveElements).toHaveBeenCalledWith([], { x: 1, y: 20 })

  chart.data.datasets = [{ data: [400, 0, null, 0] }]
  expect(dispatch()).toBeUndefined()
  event.x = 2
  expect(dispatch()).toBe(false)
})

test('leaving the chart clears active points and tooltip without cancelling the mouseout lifecycle', () => {
  const chart = chartFixture()
  const plugin = monthlyEligibilityBoundary()
  expect(plugin.beforeEvent!(chart as unknown as Chart, {
    event: { type: 'mouseout', x: null, y: null, native: null }, inChartArea: false, replay: false, cancelable: true,
  }, {})).toBeUndefined()
  expect(chart.setActiveElements).toHaveBeenCalledWith([])
  expect(chart.tooltip.setActiveElements).toHaveBeenCalledWith([], { x: 0, y: 0 })
  expect(chart.draw).toHaveBeenCalledOnce()
})
