'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import {
  STATS_VIEW_EVENT,
  statsViewSearch,
  type StatsViewState,
} from './stats-monthly'

export function StatsYearSelector({
  year,
  previousYear,
  nextYear,
  highlightedMajor,
  initialView,
}: {
  year: number
  previousYear: number
  nextYear: number
  highlightedMajor?: string
  initialView: StatsViewState
}) {
  const [view, setView] = useState(initialView)

  useEffect(() => {
    function updateView(event: Event) {
      setView((event as CustomEvent<StatsViewState>).detail)
    }
    window.addEventListener(STATS_VIEW_EVENT, updateView)
    return () => window.removeEventListener(STATS_VIEW_EVENT, updateView)
  }, [])

  function yearHref(targetYear: number) {
    const search = new URLSearchParams({ year: String(targetYear) })
    if (highlightedMajor) search.set('major', highlightedMajor)
    return `/report?${statsViewSearch(search.toString(), view)}`
  }

  return (
    <div className="flex w-fit self-start items-center border border-finance-ink">
      <Link aria-label="이전 해" className="grid h-8 w-[34px] place-items-center border-r border-finance-ink text-finance-ink hover:bg-finance-panel" href={yearHref(previousYear)}>←</Link>
      <span className="grid h-8 w-[88px] place-items-center t-body-strong text-finance-ink">{year}년</span>
      <Link aria-label="다음 해" className="grid h-8 w-[34px] place-items-center border-l border-finance-ink text-finance-ink hover:bg-finance-panel" href={yearHref(nextYear)}>→</Link>
    </div>
  )
}
