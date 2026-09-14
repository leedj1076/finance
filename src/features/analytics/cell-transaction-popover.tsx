'use client'

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useCellTransactions, type CellTransactions } from './cell-transactions'

export type CellPopoverAnchor = { x: number; y: number }

/** The popover keeps this much clearance from every viewport edge, and this much from its anchor. */
const MARGIN = 8
const GAP = 6
/** Long enough for a pointer to leave the cell and arrive inside the popover on its way to the ledger link. */
const HIDE_DELAY = 150

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Placement measures a real box, so it only ever runs in a browser. Calling useLayoutEffect during
// a server render warns; the effect below never has an element to place there anyway.
const usePlacementEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export type CellPopover = ReturnType<typeof useCellPopover>

/**
 * The shell behaviour a cell transaction popover needs, separate from what it shows: measure and
 * place inside the viewport, flip above the anchor rather than run off the bottom, hold open long
 * enough for the pointer or the keyboard to reach the content, and dismiss when the viewport moves
 * under it. `contentKey` identifies what is being shown; the measurement is cached until it
 * changes, so following the pointer costs arithmetic rather than a reflow per mousemove.
 */
export function useCellPopover({ contentKey, dismiss }: { contentKey: string | null; dismiss: () => void }) {
  const generatedId = useId()
  const id = `cell-tx-popover-${generatedId.replace(/:/g, '')}`
  const ref = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const [anchor, setAnchor] = useState<CellPopoverAnchor | null>(null)
  const openedAt = useRef<{ x: number; y: number } | null>(null)
  const size = useRef<{ width: number; height: number } | null>(null)
  const measuredFor = useRef<string | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }, [])

  const close = useCallback(() => {
    cancelHide()
    size.current = null
    measuredFor.current = null
    trigger.current = null
    setAnchor(null)
    dismiss()
  }, [cancelHide, dismiss])

  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimer.current = setTimeout(close, HIDE_DELAY)
  }, [cancelHide, close])

  const contains = useCallback(
    (node: EventTarget | null) => node instanceof Node && Boolean(ref.current?.contains(node)),
    [],
  )

  /** A new cell: drop the cached measurement so the next placement measures the new content. */
  const open = useCallback((point: CellPopoverAnchor, target: HTMLElement | null = null) => {
    cancelHide()
    trigger.current = target
    // Focusing a cell below the fold scrolls it into view, and that scroll lands after the popover
    // has opened at the post-scroll coordinates. Only a scroll that moves the page dismisses.
    openedAt.current = { x: window.scrollX, y: window.scrollY }
    setAnchor(point)
  }, [cancelHide])

  /** The pointer moved inside the cell that is already open; the content, and so its size, is unchanged. */
  const move = useCallback((point: CellPopoverAnchor) => setAnchor(point), [])

  /** Moves the keyboard into the popover, which is portaled out of the trigger's tab order. */
  const focusContent = useCallback(() => {
    const target = ref.current?.querySelector<HTMLElement>(FOCUSABLE)
    if (!target) return false
    cancelHide()
    target.focus()
    return true
  }, [cancelHide])

  const closeAndRestoreFocus = useCallback(() => {
    const target = trigger.current
    close()
    target?.focus()
  }, [close])

  useEffect(() => () => cancelHide(), [cancelHide])

  useEffect(() => {
    // The popover is fixed, so it would otherwise stay pinned to stale coordinates while the row
    // it describes scrolls away. Scrolling the popover's own list is not a viewport change.
    const dismissOnViewportChange = (event: Event) => {
      if (!ref.current || contains(event.target)) return
      const opened = openedAt.current
      if (event.type === 'scroll' && opened && window.scrollX === opened.x && window.scrollY === opened.y) return
      close()
    }
    window.addEventListener('scroll', dismissOnViewportChange, true)
    window.addEventListener('resize', dismissOnViewportChange)
    return () => {
      window.removeEventListener('scroll', dismissOnViewportChange, true)
      window.removeEventListener('resize', dismissOnViewportChange)
    }
  }, [close, contains])

  usePlacementEffect(() => {
    const element = ref.current
    if (!element || !anchor) return
    if (measuredFor.current !== contentKey || !size.current) {
      const bounds = element.getBoundingClientRect()
      size.current = { width: bounds.width, height: bounds.height }
      measuredFor.current = contentKey
    }
    const { width, height } = size.current
    const left = Math.max(MARGIN, Math.min(anchor.x + GAP, window.innerWidth - width - MARGIN))
    const below = anchor.y + GAP
    const top = below + height > window.innerHeight - MARGIN
      ? Math.max(MARGIN, anchor.y - height - GAP)
      : below
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.style.visibility = 'visible'
  })

  return { anchor, cancelHide, close, closeAndRestoreFocus, focusContent, id, move, open, ref, scheduleHide }
}

export type CellPopoverController = { cells: CellTransactions; popover: CellPopover }

/**
 * A table shows one popover at a time, so its rows share one request instance and one shell. Two
 * shells would let a row that the pointer just left close the popover a sibling row has opened.
 */
export const CellPopoverContext = createContext<CellPopoverController | null>(null)

export function useCellPopoverController(): CellPopoverController {
  const cells = useCellTransactions()
  const popover = useCellPopover({ contentKey: cells.key, dismiss: cells.close })
  return { cells, popover }
}

/** The table's controller when a provider is above, otherwise a private one for a lone row. */
export function useSharedCellPopover(): CellPopoverController {
  const shared = useContext(CellPopoverContext)
  const isolated = useCellPopoverController()
  return shared ?? isolated
}

/**
 * The dark card itself, portaled to the document so no table overflow can clip it. It starts
 * hidden in the corner and the placement effect above reveals it once it has been measured.
 */
export function CellPopoverPortal({ popover, children }: { popover: CellPopover; children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed z-50 max-h-[min(420px,calc(100vh-16px))] w-[min(360px,calc(100vw-16px))] overflow-y-auto bg-finance-ink p-3 text-white shadow-xl"
      id={popover.id}
      onBlur={popover.scheduleHide}
      onFocus={popover.cancelHide}
      onKeyDown={event => { if (event.key === 'Escape') popover.closeAndRestoreFocus() }}
      onMouseEnter={popover.cancelHide}
      onMouseLeave={popover.scheduleHide}
      ref={popover.ref}
      role="tooltip"
      style={{ left: MARGIN, top: MARGIN, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}
