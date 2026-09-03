'use client'

import Link from 'next/link'
import { useRef } from 'react'

import { ledgerUrl, type LedgerFilters } from './filters'

type LedgerFilterFormProps = {
  accounts: Array<{ id: number; name: string }>
  filters: LedgerFilters
  majorOptions: string[]
  month: string
  tab: string
}

export function LedgerFilterForm({ accounts, filters, majorOptions, month, tab }: LedgerFilterFormProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const anyFilter = Boolean(filters.account || filters.flow || filters.major || filters.q)
  const inputClass = 'h-[30px] border border-finance-border bg-white px-3 t-caption text-finance-muted outline-none focus:border-finance-blue'

  function submitSelection() {
    formRef.current?.requestSubmit()
  }

  return (
    <form action="/ledger" className="flex flex-wrap items-center gap-2 border-b border-finance-border py-4" ref={formRef}>
      <input name="month" type="hidden" value={month} />
      <input name="tab" type="hidden" value={tab} />
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
      <input aria-label="사용내역 검색" className={`${inputClass} ml-auto min-w-[220px]`} defaultValue={filters.q} name="q" placeholder="가맹점·메모 검색" type="search" />
      <button className="h-[30px] bg-finance-ink px-3.5 t-caption font-semibold text-white hover:bg-finance-blue" type="submit">검색</button>
      {anyFilter && <Link className="self-center text-center t-caption font-semibold text-finance-blue hover:text-finance-ink" href={ledgerUrl(month, { account: '', flow: '', major: '', q: '' }, { tab })}>초기화</Link>}
    </form>
  )
}
