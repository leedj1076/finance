'use client'

import { useEffect, useRef } from 'react'

export type PointerPoint = { x: number; y: number }

/**
 * Chromium fires mouseenter and mouseleave whenever the element under the pointer changes, and
 * scrolling changes it without the user touching the mouse. Focusing a cell below the fold scrolls
 * it into view, so the hover that scroll invents would otherwise cancel the request the focus just
 * made, and the pointer never moved.
 *
 * Scrolling fires no mousemove, which is what tells the two apart. A boundary event reports the
 * viewport position the pointer already had when the page moved under it, while a user who moved
 * onto a cell arrives somewhere new: the browser dispatches the boundary events before the
 * mousemove that reports the new position, so the recorded point is still the one the pointer
 * came from.
 */
export function createPointerTracker() {
  let last: PointerPoint | null = null
  return {
    /** Records where the pointer is. Only real pointer motion may call this. */
    moveTo(point: PointerPoint) { last = point },
    /** Whether the pointer travelled here, rather than the page scrolling underneath it. */
    movedTo(point: PointerPoint) { return last === null || last.x !== point.x || last.y !== point.y },
  }
}

export type PointerTracker = ReturnType<typeof createPointerTracker>

/**
 * One tracker per hook call, fed by every pointer move on the page and not only the ones over
 * cells. That is one per table where the caller is the table itself (stats-monthly-section), but
 * PlanTrend calls it per row, so /budgets mounts 18 of these — measured 20 document mousemove
 * listeners against 18 plan rows, with 2 belonging to the rest of the app.
 *
 * They are redundant rather than wrong: every tracker sees the same document-level stream and
 * converges on the same `last`, so 17 of them only cost an allocation per move. Hoisting the
 * shared one the way PlanTrend already shares its popover would collapse them.
 */
export function usePointerTracker() {
  const tracker = useRef(createPointerTracker())
  useEffect(() => {
    const record = (event: MouseEvent) => tracker.current.moveTo({ x: event.clientX, y: event.clientY })
    document.addEventListener('mousemove', record, true)
    return () => document.removeEventListener('mousemove', record, true)
  }, [])
  return tracker
}
