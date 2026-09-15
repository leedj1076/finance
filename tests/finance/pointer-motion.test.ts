import { describe, expect, test } from 'vitest'

import { createPointerTracker } from '@/features/analytics/pointer-motion'

describe('createPointerTracker', () => {
  test('takes a hover at face value when no pointer motion has been recorded yet', () => {
    expect(createPointerTracker().movedTo({ x: 40, y: 90 })).toBe(true)
  })

  test('reports no movement when a boundary event repeats the point the pointer already had', () => {
    const pointer = createPointerTracker()
    pointer.moveTo({ x: 40, y: 90 })
    // Focusing a cell below the fold scrolls the table under a pointer that never moved, and the
    // mouseenter that scroll invents carries the same viewport coordinates as the last mousemove.
    expect(pointer.movedTo({ x: 40, y: 90 })).toBe(false)
  })

  test('counts a change in either axis as movement', () => {
    const pointer = createPointerTracker()
    pointer.moveTo({ x: 40, y: 90 })
    expect(pointer.movedTo({ x: 41, y: 90 })).toBe(true)
    expect(pointer.movedTo({ x: 40, y: 91 })).toBe(true)
  })

  test('does not record the points it is asked about, only the ones the pointer moved to', () => {
    const pointer = createPointerTracker()
    pointer.moveTo({ x: 40, y: 90 })
    expect(pointer.movedTo({ x: 55, y: 90 })).toBe(true)
    // The browser fires the boundary event before the mousemove, so asking must not move the mark:
    // a second cell arriving at the same place by scrolling is still motionless.
    expect(pointer.movedTo({ x: 40, y: 90 })).toBe(false)
  })

  test('keeps each tracker history to itself', () => {
    const table = createPointerTracker()
    const trend = createPointerTracker()
    table.moveTo({ x: 40, y: 90 })
    expect(trend.movedTo({ x: 40, y: 90 })).toBe(true)
  })
})
