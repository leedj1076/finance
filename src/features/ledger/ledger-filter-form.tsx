'use client'

import Link from 'next/link'
import { useRef } from 'react'

import { ledgerUrl, type LedgerFilters } from './filters'

type LedgerFilterFormProps = {
  accounts: Array<{ id: number; name: string }>
  filters: LedgerFilters
  majorOptions: string[]
  month: string
}

export function LedgerFilterForm({ accounts, filters, majorOptions, month }: LedgerFilterFormProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const anyFilter = Boolean(filters.account || filters.flow || filters.major || filters.q)
  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

  function submitSelection() {
    formRef.current?.requestSubmit()
  }

  return (
    <form action="/ledger" className="grid gap-2 border-b border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(180px,1.4fr)_auto_auto]" ref={formRef}>
      <input name="month" type="hidden" value={month} />
      <select aria-label="거래 유형 필터" className={inputClass} defaultValue={filters.flow} name="flow" onChange={submitSelection}>
        <option value="">전체 유형</option><option value="expense">지출</option><option value="income">수입</option><option value="saving">저축</option>
      </select>
      <select aria-label="대분류 필터" className={inputClass} defaultValue={filters.major} name="major" onChange={submitSelection}>
        <option value="">전체 분류</option>
        {majorOptions.map((major) => <option key={major} value={major}>{major}</option>)}
      </select>
      <select aria-label="결제수단 필터" className={inputClass} defaultValue={filters.account} name="account" onChange={submitSelection}>
        <option value="">전체 결제수단</option>
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      <input aria-label="사용내역 검색" className={inputClass} defaultValue={filters.q} name="q" placeholder="사용내역 검색…" type="search" />
      <button className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700" type="submit">검색</button>
      {anyFilter && <Link className="self-center text-center text-sm text-zinc-500 hover:text-zinc-950" href={ledgerUrl(month, { account: '', flow: '', major: '', q: '' })}>초기화</Link>}
    </form>
  )
}
