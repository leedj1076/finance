'use client'

import Link from 'next/link'
import { useId, useState } from 'react'

import type { getCategoryPageData } from '@/features/analytics/category-page'
import type { getAnalysisData } from '@/features/analytics/queries'
import { formatRate, formatWon } from '@/lib/finance'
import { ledgerUrl, type LedgerFilters } from './filters'

type AnalysisData = Pick<Awaited<ReturnType<typeof getAnalysisData>>, 'month' | 'flow' | 'ranks'>
type CategoryData = Pick<Awaited<ReturnType<typeof getCategoryPageData>>, 'percent' | 'subs' | 'merchants' | 'transactions'>

export function LedgerCategoriesPanel({ data, detail, filters }: {
  data: AnalysisData
  detail: CategoryData | null
  filters: LedgerFilters
}) {
  const [expanded, setExpanded] = useState(false)
  const ranksId = useId()
  const maxRank = Math.max(1, ...data.ranks.map(rank => Math.abs(rank.amount)))
  // Keep a selected lower-ranked category visible even when returning from the list tab.
  const visibleRanks = data.ranks.filter((rank, index) => expanded || index < 8 || rank.major === filters.major)
  const selectedRows = detail?.transactions.filter(row => !filters.sub || row.sub === filters.sub) ?? []
  const selectedAmount = selectedRows.reduce((total, row) => total + row.amount, 0)
  const detailFilters = filters

  return (
    <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(300px,0.7fr)_minmax(0,1.3fr)]">
      <section className="min-w-0 border-t border-finance-ink pt-4">
        <h2 className="t-section text-finance-ink">카테고리 순위</h2>
        <p className="mt-1 t-caption text-finance-muted">선택한 카테고리의 상세를 확인합니다. 다른 카테고리 순위는 유지됩니다.</p>
        <div className="mt-5 space-y-2" id={ranksId}>
          {visibleRanks.map(rank => {
            const selected = filters.major === rank.major
            return (
              <div className={`border-l-2 p-3 ${selected ? 'border-finance-blue bg-finance-blue-tint' : 'border-transparent'}`} key={rank.major}>
                <div className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 t-body">
                  <span className="text-finance-faint">{data.ranks.indexOf(rank) + 1}</span>
                  <Link aria-current={selected ? 'true' : undefined} className={`truncate t-body-strong ${selected ? 'text-finance-blue' : 'text-finance-ink hover:text-finance-blue'}`} scroll={false}
                    href={ledgerUrl(data.month, { ...detailFilters, major: rank.major, sub: selected ? filters.sub : '' }, { tab: 'categories' })}>
                    {rank.major}
                  </Link>
                  <div className="text-right">
                    <p className="t-body-strong tabular-nums text-finance-ink">{formatWon(rank.amount)}원</p>
                    <p className={`mt-0.5 t-caption ${rank.delta > 0 ? 'text-finance-red' : rank.delta < 0 ? 'text-finance-green' : 'text-finance-faint'}`}>{rank.delta === 0 ? '–' : `${rank.delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(rank.delta))}원`}</p>
                  </div>
                </div>
                <div className="ml-8 mt-2 h-[5px] overflow-hidden bg-finance-track"><div className="h-full bg-finance-blue" style={{ width: `${Math.abs(rank.amount) / maxRank * 100}%` }} /></div>
              </div>
            )
          })}
          {data.ranks.length === 0 && <p className="py-10 text-center t-body text-finance-muted">이 필터에는 거래가 없습니다.</p>}
        </div>
        {data.ranks.length > 8 && <button aria-controls={ranksId} aria-expanded={expanded} className="mt-3 h-[30px] border border-finance-border px-3 t-caption-strong text-finance-ink hover:bg-finance-panel" onClick={() => setExpanded(value => !value)} type="button">{expanded ? '접기' : '전체 보기'}</button>}
      </section>

      <section className="min-w-0 border-t border-finance-ink pt-4">
        {!detail || !filters.major ? (
          <div className="grid min-h-56 place-items-center border-y border-finance-hairline text-center">
            <div><p className="t-body-strong text-finance-ink">카테고리를 선택하세요</p><p className="mt-1 t-caption text-finance-muted">소분류·가맹점 구성과 해당 거래를 한 번에 확인할 수 있습니다.</p></div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-finance-hairline pb-4">
              <div><p className="t-caption text-finance-muted">선택 카테고리</p><h2 className="mt-1 t-section text-finance-ink">{filters.major}</h2><p className="mt-1 t-caption text-finance-muted">{detail.transactions.length}건 · 전체 대비 {formatRate(detail.percent)}%</p></div>
              <Link className="h-[30px] bg-finance-ink px-3 py-1.5 t-body-strong text-white hover:bg-finance-blue" href={ledgerUrl(data.month, detailFilters, { tab: 'list' })}>거래 보기 →</Link>
            </div>
            <div className="grid gap-6 pt-5 md:grid-cols-2">
              <div className="min-w-0">
                <h3 className="t-label uppercase text-finance-muted">소분류</h3>
                <Link aria-current={!filters.sub ? 'true' : undefined} className={`mt-2 inline-block py-2 t-caption-strong ${!filters.sub ? 'text-finance-blue' : 'text-finance-muted'}`} scroll={false} href={ledgerUrl(data.month, { ...detailFilters, sub: '' }, { tab: 'categories' })}>전체 소분류</Link>
                <div className="divide-y divide-finance-hairline">{detail.subs.map(sub => (
                  <Link aria-current={filters.sub === sub.sub ? 'true' : undefined} aria-label={`소분류 ${sub.sub}`} className={`flex justify-between gap-3 px-2 py-3 t-body ${filters.sub === sub.sub ? 'bg-finance-blue-tint text-finance-blue' : 'text-finance-ink hover:bg-finance-panel'}`} key={sub.sub} scroll={false}
                    href={ledgerUrl(data.month, { ...detailFilters, sub: sub.sub }, { tab: 'categories' })}>
                    <span className="min-w-0 break-words">{sub.sub} <span className="t-caption text-finance-faint">{sub.count}건</span></span><strong className="shrink-0 tabular-nums">{formatWon(sub.amount)}원</strong>
                  </Link>
                ))}</div>
              </div>
              <div className="min-w-0"><h3 className="t-label uppercase text-finance-muted">가맹점</h3><div className="mt-2 divide-y divide-finance-hairline">{detail.merchants.map(merchant => <div className="flex justify-between gap-3 py-3 t-body" key={merchant.name}><span className="min-w-0 break-words">{merchant.name} <span className="t-caption text-finance-faint">{merchant.count}건</span></span><strong className="shrink-0 tabular-nums">{formatWon(merchant.amount)}원</strong></div>)}</div></div>
            </div>
            <section aria-label="카테고리 거래 내역" className="mt-6 border-t border-finance-ink pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="t-section text-finance-ink">거래 내역 · {filters.sub || '전체 소분류'}</h3><p aria-live="polite" className="t-caption-strong tabular-nums text-finance-muted">{selectedRows.length}건 · {formatWon(selectedAmount)}원</p></div>
              <ul className="mt-3 divide-y divide-finance-hairline">{selectedRows.map(row => (
                <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3" key={row.id}>
                  <div className="min-w-0"><p className="break-words t-body-strong text-finance-ink">{row.merchant || row.memo || row.sub}</p><p className="mt-1 break-words t-caption text-finance-muted">{row.date} · {row.sub}{row.accountName ? ` · ${row.accountName}` : ''}</p></div>
                  <span className="t-body-strong tabular-nums text-finance-ink">{formatWon(row.amount)}원</span>
                </li>
              ))}</ul>
              {selectedRows.length === 0 && <p className="py-6 t-body text-finance-muted">조건에 맞는 거래가 없습니다.</p>}
            </section>
          </>
        )}
      </section>
    </div>
  )
}
