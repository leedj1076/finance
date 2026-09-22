'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'

import type { getCategoryPageData } from '@/features/analytics/category-page'
import type { getAnalysisData } from '@/features/analytics/queries'
import { formatRate, formatWon } from '@/lib/finance'
import { ledgerUrl, type LedgerFilters } from './filters'

type AnalysisData = Pick<Awaited<ReturnType<typeof getAnalysisData>>, 'month' | 'flow' | 'ranks'>
type CategoryData = Pick<Awaited<ReturnType<typeof getCategoryPageData>>, 'percent' | 'subs' | 'transactions'>

function focusSection(element: HTMLElement | null) {
  element?.focus({ preventScroll: true })
  element?.scrollIntoView({ block: 'start', behavior: 'instant' })
}

export function LedgerCategoriesPanel({ data, detail, filters }: {
  data: AnalysisData
  detail: CategoryData | null
  filters: LedgerFilters
}) {
  const [expanded, setExpanded] = useState(false)
  const ranksId = useId()
  const ranksRef = useRef<HTMLDivElement>(null)
  const detailHeadingRef = useRef<HTMLHeadingElement>(null)
  const transactionsHeadingRef = useRef<HTMLHeadingElement>(null)
  const pendingFocus = useRef<{ target: 'category' | 'transactions'; major: string; sub: string } | null>(null)
  const maxRank = Math.max(1, ...data.ranks.map(rank => Math.abs(rank.amount)))
  // Keep a selected lower-ranked category visible even when returning from the list tab.
  const visibleRanks = data.ranks.filter((rank, index) => expanded || index < 8 || rank.major === filters.major)
  const selectedRows = detail?.transactions.filter(row => !filters.sub || row.sub === filters.sub) ?? []
  const selectedAmount = selectedRows.reduce((total, row) => total + row.amount, 0)
  const detailFilters = filters

  // Move only after the requested URL selection has rendered, never on initial load.
  useEffect(() => {
    const pending = pendingFocus.current
    if (!pending || !detail || pending.major !== filters.major || pending.sub !== (filters.sub ?? '')) return
    pendingFocus.current = null
    if (window.matchMedia('(min-width: 1280px)').matches) return
    focusSection(pending.target === 'category' ? detailHeadingRef.current : transactionsHeadingRef.current)
  }, [detail, filters.major, filters.sub])

  function requestDetailFocus(event: MouseEvent<HTMLAnchorElement>, target: 'category' | 'transactions', major: string, sub: string) {
    // Preserve new-tab/window behavior and the desktop side-by-side view.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || window.matchMedia('(min-width: 1280px)').matches) return
    if (major === filters.major && sub === (filters.sub ?? '')) {
      focusSection(target === 'category' ? detailHeadingRef.current : transactionsHeadingRef.current)
    } else {
      pendingFocus.current = { target, major, sub }
    }
  }

  return (
    <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(300px,0.7fr)_minmax(0,1.3fr)]">
      <section className="min-w-0 border-t border-finance-ink pt-4">
        <h2 className="t-section text-finance-ink">카테고리 순위</h2>
        <p className="mt-1 t-caption text-finance-muted">선택한 카테고리의 상세를 확인합니다. 다른 카테고리 순위는 유지됩니다.</p>
        <div className="mt-5 space-y-2" id={ranksId} ref={ranksRef}>
          {visibleRanks.map(rank => {
            const selected = filters.major === rank.major
            return (
              <Link aria-current={selected ? 'true' : undefined} aria-label={rank.major}
                className={`block scroll-mt-24 border-l-2 p-3 ${selected ? 'border-finance-blue bg-finance-blue-tint' : 'border-transparent hover:bg-finance-panel'}`} key={rank.major} scroll={false}
                onClick={event => requestDetailFocus(event, 'category', rank.major, selected ? filters.sub ?? '' : '')}
                href={ledgerUrl(data.month, { ...detailFilters, major: rank.major, sub: selected ? filters.sub : '' }, { tab: 'categories' })}>
                <div className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 t-body">
                  <span className="text-finance-faint">{data.ranks.indexOf(rank) + 1}</span>
                  <span className={`truncate t-body-strong ${selected ? 'text-finance-blue' : 'text-finance-ink'}`}>
                    {rank.major}
                  </span>
                  <div className="text-right">
                    <p className="t-body-strong tabular-nums text-finance-ink">{formatWon(rank.amount)}원</p>
                    <p className={`mt-0.5 t-caption ${rank.delta > 0 ? 'text-finance-red' : rank.delta < 0 ? 'text-finance-green' : 'text-finance-faint'}`}>{rank.delta === 0 ? '–' : `${rank.delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(rank.delta))}원`}</p>
                  </div>
                </div>
                <div className="ml-8 mt-2 h-[5px] overflow-hidden bg-finance-track"><div className="h-full bg-finance-blue" style={{ width: `${Math.abs(rank.amount) / maxRank * 100}%` }} /></div>
              </Link>
            )
          })}
          {data.ranks.length === 0 && <p className="py-10 text-center t-body text-finance-muted">이 필터에는 거래가 없습니다.</p>}
        </div>
        {data.ranks.length > 8 && <button aria-controls={ranksId} aria-expanded={expanded} className="mt-3 h-[30px] border border-finance-border px-3 t-caption-strong text-finance-ink hover:bg-finance-panel" onClick={() => setExpanded(value => !value)} type="button">{expanded ? '접기' : '전체 보기'}</button>}
      </section>

      <section className="min-w-0 border-t border-finance-ink pt-4">
        {!detail || !filters.major ? (
          <div className="grid min-h-56 place-items-center border-y border-finance-hairline text-center">
            <div><p className="t-body-strong text-finance-ink">카테고리를 선택하세요</p><p className="mt-1 t-caption text-finance-muted">소분류 구성과 해당 거래를 한 번에 확인할 수 있습니다.</p></div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-finance-hairline pb-4">
              <div><p className="t-caption text-finance-muted">선택 카테고리</p><h2 className="mt-1 scroll-mt-24 t-section text-finance-ink" ref={detailHeadingRef} tabIndex={-1}>{filters.major}</h2><p className="mt-1 t-caption text-finance-muted">{detail.transactions.length}건 · 전체 대비 {formatRate(detail.percent)}%</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="min-h-[36px] border border-finance-border px-3 t-caption-strong text-finance-ink hover:bg-finance-panel xl:hidden" type="button"
                  onClick={() => focusSection(ranksRef.current?.querySelector<HTMLAnchorElement>('[aria-current="true"]') ?? null)}>
                  <span aria-hidden="true">← </span>카테고리 다시 선택
                </button>
                <Link className="h-[30px] bg-finance-ink px-3 py-1.5 t-body-strong text-white hover:bg-finance-blue" href={ledgerUrl(data.month, detailFilters, { tab: 'list' })}>거래 보기 →</Link>
              </div>
            </div>
            <div className="grid gap-6 pt-5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div className="min-w-0">
                <h3 className="t-section text-finance-ink">소분류</h3>
                <Link aria-current={!filters.sub ? 'true' : undefined} className={`mt-2 inline-block py-2 t-caption-strong ${!filters.sub ? 'text-finance-blue' : 'text-finance-muted'}`} scroll={false}
                  onClick={event => requestDetailFocus(event, 'transactions', filters.major, '')}
                  href={ledgerUrl(data.month, { ...detailFilters, sub: '' }, { tab: 'categories' })}>전체 소분류</Link>
                <div className="divide-y divide-finance-hairline">{detail.subs.map(sub => (
                  <Link aria-current={filters.sub === sub.sub ? 'true' : undefined} aria-label={`소분류 ${sub.sub}`} className={`flex justify-between gap-3 px-2 py-3 t-body ${filters.sub === sub.sub ? 'bg-finance-blue-tint text-finance-blue' : 'text-finance-ink hover:bg-finance-panel'}`} key={sub.sub} scroll={false}
                    onClick={event => requestDetailFocus(event, 'transactions', filters.major, sub.sub)}
                    href={ledgerUrl(data.month, { ...detailFilters, sub: sub.sub }, { tab: 'categories' })}>
                    <span className="min-w-0 break-words">{sub.sub} <span className="t-caption text-finance-faint">{sub.count}건</span></span><strong className="shrink-0 tabular-nums">{formatWon(sub.amount)}원</strong>
                  </Link>
                ))}</div>
              </div>
              <section aria-label="카테고리 거래 내역" className="min-w-0">
                <h3 className="scroll-mt-24 t-section text-finance-ink" ref={transactionsHeadingRef} tabIndex={-1}>거래 내역 · {filters.sub || '전체 소분류'}</h3>
                <p aria-live="polite" className="mt-2 py-2 t-caption-strong tabular-nums text-finance-muted">{selectedRows.length}건 · {formatWon(selectedAmount)}원</p>
                <ul className="divide-y divide-finance-hairline">{selectedRows.map(row => (
                  <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3" key={row.id}>
                    <div className="min-w-0"><p className="break-words t-body-strong text-finance-ink">{row.merchant || row.memo || row.sub}</p><p className="mt-1 break-words t-caption text-finance-muted">{row.date} · {row.sub}{row.accountName ? ` · ${row.accountName}` : ''}</p></div>
                    <span className="t-body-strong tabular-nums text-finance-ink">{formatWon(row.amount)}원</span>
                  </li>
                ))}</ul>
                {selectedRows.length === 0 && <p className="py-6 t-body text-finance-muted">조건에 맞는 거래가 없습니다.</p>}
              </section>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
