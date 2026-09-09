'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { ledgerUrl, type LedgerFilters, type LedgerSort } from './filters'

export function LedgerSortSelect({ month, filters }: { month: string; filters: LedgerFilters }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <select
      aria-label="거래 정렬"
      aria-busy={pending}
      className="h-[30px] border border-finance-border bg-white px-3 t-caption text-finance-muted disabled:opacity-50"
      disabled={pending}
      onChange={(event) => {
        const sort = event.target.value as LedgerSort
        startTransition(() => router.push(ledgerUrl(month, { ...filters, sort }, { tab: 'list' }), { scroll: false }))
      }}
      value={filters.sort ?? 'date-desc'}
    >
      <option value="date-desc">날짜 최신순</option>
      <option value="date-asc">날짜 오래된순</option>
      <option value="amount-desc">금액 높은순</option>
      <option value="amount-asc">금액 낮은순</option>
    </select>
  )
}
