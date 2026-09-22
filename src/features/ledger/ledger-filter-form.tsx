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
  const subRef = useRef<HTMLInputElement>(null)
  const anyFilter = Boolean(filters.account || filters.flow || filters.major || filters.q)
  const inputClass = 'h-[30px] border border-finance-border bg-white px-3 t-caption text-finance-muted outline-none focus:border-finance-blue'

  function submitSelection() {
    formRef.current?.requestSubmit()
  }

  return (
    <form action="/ledger" className="flex flex-wrap items-center gap-2 border-b border-finance-border py-4" ref={formRef}>
      <input name="month" type="hidden" value={month} />
      <input name="tab" type="hidden" value={tab} />
      <input defaultValue={filters.sub ?? ''} name="sub" ref={subRef} type="hidden" />
      {filters.sort && <input name="sort" type="hidden" value={filters.sort} />}
      <select aria-label="거래 유형 필터" className={inputClass} defaultValue={filters.flow} name="flow" onChange={submitSelection}>
        <option value="">전체 유형</option><option value="expense">지출</option><option value="income">수입</option><option value="saving">저축</option>
      </select>
      <select aria-label="대분류 필터" className={inputClass} defaultValue={filters.major} name="major" onChange={() => { if (subRef.current) subRef.current.value = ''; submitSelection() }}>
        <option value="">전체 분류</option>
        {majorOptions.map((major) => <option key={major} value={major}>{major}</option>)}
      </select>
      <select aria-label="결제수단 필터" className={inputClass} defaultValue={filters.account} name="account" onChange={submitSelection}>
        <option value="">전체 결제수단</option>
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      <input aria-label="사용내역 검색" className={`${inputClass} ml-auto min-w-[220px]`} defaultValue={filters.q} name="q" placeholder="가맹점·메모 검색" type="search" />
      <button className="h-[30px] bg-finance-ink px-3.5 t-caption-strong text-white hover:bg-finance-blue" type="submit">검색</button>
      {filters.sub && <Link scroll={false} className="self-center t-caption-strong text-finance-blue" href={ledgerUrl(month, { ...filters, sub: '' }, { tab })} aria-label="소분류 선택 해제">{filters.sub} ×</Link>}
      {filters.major && <Link scroll={false} className="self-center t-caption-strong text-finance-blue" href={ledgerUrl(month, { ...filters, major: '', sub: '' }, { tab })}>카테고리 선택 해제</Link>}
      {anyFilter && <Link scroll={false} className="self-center text-center t-caption-strong text-finance-muted hover:text-finance-ink" href={ledgerUrl(month, { account: '', flow: '', major: '', q: '', sort: filters.sort }, { tab })}>전체 필터 초기화</Link>}
    </form>
  )
}
