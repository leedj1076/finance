'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

export function NavigationFeedback() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentRoute = `${pathname}?${searchParams.toString()}`
  const [pendingFrom, setPendingFrom] = useState<string | null>(null)
  const pending = pendingFrom === currentRoute

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
    <div aria-label="새 화면 불러오는 중" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden bg-emerald-100" role="status">
      <div className="route-progress-bar h-full w-2/5 rounded-r-full bg-emerald-600" />
      <span className="sr-only">새 화면 불러오는 중…</span>
    </div>
  )
}
