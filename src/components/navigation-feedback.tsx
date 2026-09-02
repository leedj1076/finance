'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

export function NavigationFeedback() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentRoute = `${pathname}?${searchParams.toString()}`
  const [pendingFrom, setPendingFrom] = useState<string | null>(null)
  const [showLabel, setShowLabel] = useState(false)
  const pending = pendingFrom === currentRoute

  useEffect(() => {
    if (!pending) {
      setShowLabel(false)
      return
    }

    const timer = window.setTimeout(() => setShowLabel(true), 180)
    return () => window.clearTimeout(timer)
  }, [pending])

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
        || !(event.target instanceof Element)
      ) return

      const anchor = event.target.closest('a')
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return

      const destination = new URL(anchor.href, window.location.href)
      const destinationRoute = `${destination.pathname}?${destination.searchParams.toString()}`
      if (destination.origin !== window.location.origin || destinationRoute === currentRoute) return

      setPendingFrom(currentRoute)
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [currentRoute])

  if (!pending) return null

  return (
    <div aria-label="새 화면 불러오는 중" aria-live="polite" className="pointer-events-none fixed inset-0 z-[100]" role="status">
      <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-emerald-100/90">
        <div className="route-progress-bar h-full w-2/5 rounded-r-full bg-emerald-600" />
      </div>
      {showLabel && (
        <div className="route-loading-label absolute left-1/2 top-[70px] flex -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-200 bg-white/95 px-3 py-2 text-xs font-semibold text-zinc-700 shadow-lg backdrop-blur">
          <span aria-hidden className="route-loading-spinner h-3.5 w-3.5 rounded-full border-2 border-emerald-200 border-t-emerald-600" />
          불러오는 중
        </div>
      )}
      <span className="sr-only">새 화면 불러오는 중…</span>
    </div>
  )
}
