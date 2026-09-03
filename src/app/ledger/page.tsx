import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SubmitButton } from '@/components/submit-button'
import { hasLedgerFilters, ledgerUrl, parseLedgerFilters } from '@/features/ledger/filters'
import { LedgerFilterForm } from '@/features/ledger/ledger-filter-form'
import { LedgerTransactionsTable } from '@/features/ledger/ledger-transactions-table'
import { getLedgerData, getLedgerFormOptions } from '@/features/ledger/queries'
import { TransactionForm } from '@/features/ledger/transaction-form'
import { applyRecurringMonth } from '@/features/recurring/actions'
import { getRecurringData } from '@/features/recurring/queries'
import { currentMonthInKorea, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type LedgerPageProps = {
  searchParams: Promise<{
    account?: string | string[]
    fflow?: string | string[]
    fmajor?: string | string[]
    flow?: string | string[]
    major?: string | string[]
    month?: string | string[]
    q?: string | string[]
    recurringAdded?: string | string[]
    recurringSkipped?: string | string[]
  }>
}

export default async function LedgerPage({ searchParams }: LedgerPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const params = await searchParams
  const requestedMonth = typeof params.month === 'string' ? params.month : undefined
  const filters = parseLedgerFilters(params)
  const anyFilter = hasLedgerFilters(filters)
  const recurringAdded = typeof params.recurringAdded === 'string' ? Number(params.recurringAdded) : null
  const recurringSkipped = typeof params.recurringSkipped === 'string' ? Number(params.recurringSkipped) : null
  const [data, formOptions] = await Promise.all([
    getLedgerData(household.householdId, requestedMonth, filters),
    getLedgerFormOptions(household.householdId),
  ])
  const recurring = await getRecurringData(household.householdId, data.month)
  const currentMonth = currentMonthInKorea()
  const defaultDate = data.month === currentMonth
    ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
    : `${data.month}-01`
  const majorOptions = [...new Set(formOptions.categories.map((category) => category.major))]
  const recurringPending = Math.max(recurring.activeCount - recurring.generatedCount, 0)

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="ledger" email={household.email} />
      <main className="mx-auto max-w-[1680px] px-5 pb-14 pt-9 sm:px-12">
        <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">거래 원장</p>
            <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">거래</h1>
            <p className="mt-2 text-xs text-finance-muted">한 달의 거래를 입력하고, 찾고, 바로잡는 곳</p>
          </div>
          <div className="flex items-center border border-finance-ink">
            <Link aria-label="이전 달" className="grid h-8 w-[34px] place-items-center border-r border-finance-ink text-[13px] hover:bg-finance-track" href={ledgerUrl(data.previousMonth, filters)}>←</Link>
            <form action="/ledger" className="flex h-8 items-center">
              {filters.account && <input name="account" type="hidden" value={filters.account} />}
              {filters.flow && <input name="flow" type="hidden" value={filters.flow} />}
              {filters.major && <input name="major" type="hidden" value={filters.major} />}
              {filters.q && <input name="q" type="hidden" value={filters.q} />}
              <input aria-label="조회 월" className="h-8 w-[124px] border-0 bg-white px-2 text-center text-[13px] font-semibold text-finance-ink outline-none" defaultValue={data.month} max={data.latestMonth} name="month" type="month" />
              <SubmitButton className="h-8 border-l border-finance-ink bg-finance-ink px-3 text-xs font-semibold text-white hover:bg-finance-blue" pendingLabel="불러오는 중…" type="submit">보기</SubmitButton>
            </form>
            <Link aria-label="다음 달" className="grid h-8 w-[34px] place-items-center border-l border-finance-ink text-[13px] hover:bg-finance-track" href={ledgerUrl(data.nextMonth, filters)}>→</Link>
          </div>
        </header>

        <div className="mt-6 flex gap-1.5 overflow-x-auto border-b border-finance-border pb-4">
          {data.availableMonths.map((item) => (
            <Link className={`inline-flex h-[30px] shrink-0 items-center border px-3.5 text-xs font-medium ${item.month === data.month ? 'border-finance-ink bg-finance-ink font-semibold text-white' : 'border-finance-border bg-white text-finance-muted hover:border-finance-ink hover:text-finance-ink'}`} href={ledgerUrl(item.month, filters)} key={item.month}>
              {item.month} · {item.count}건
            </Link>
          ))}
        </div>

        <section className="flex flex-col gap-3 border-b border-finance-border py-4 sm:flex-row sm:items-center">
          <span aria-hidden className={`h-[7px] w-[7px] shrink-0 ${recurringPending > 0 ? 'bg-finance-amber' : 'bg-finance-green'}`} />
          <p className="text-[13px] text-finance-ink">
            <strong>{data.month} 정기거래</strong> · 활성 {recurring.activeCount}건 중 {recurring.generatedCount}건 반영
            {recurringAdded !== null && Number.isInteger(recurringAdded) && <span className="ml-2 text-finance-green">방금 {recurringAdded}건 추가{recurringSkipped ? ` · ${recurringSkipped}건 건너뜀` : ''}</span>}
          </p>
          <div className="ml-auto flex items-center gap-3">
            <Link className="text-xs font-semibold text-finance-muted hover:text-finance-blue" href={`/recurring?month=${data.month}`}>규칙 설정</Link>
            {recurringPending > 0 && (
              <form action={applyRecurringMonth}>
                <input name="month" type="hidden" value={data.month} />
                <SubmitButton className="h-[30px] bg-finance-ink px-3.5 text-xs font-semibold text-white hover:bg-finance-blue" pendingLabel="반영 중…" type="submit">미반영 {recurringPending}건 반영</SubmitButton>
              </form>
            )}
          </div>
        </section>

        <TransactionForm accounts={formOptions.accounts} categories={formOptions.categories} defaultDate={defaultDate} editing={null} filters={filters} month={data.month} />

        <section className="mt-6">
          <div className="flex items-baseline justify-between border-t border-finance-ink pt-4">
            <h2 className="text-sm font-bold text-finance-ink">거래 내역</h2>
            <span className="text-[11px] text-finance-faint">최근순</span>
          </div>
          <LedgerFilterForm accounts={formOptions.accounts} filters={filters} majorOptions={majorOptions} month={data.month} />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-finance-ink py-3 text-xs text-finance-muted">
            <strong className="text-finance-ink">{anyFilter ? '필터 결과' : '이 달 전체'} {data.filteredTotals.count}건</strong>
            <span>수입 <strong className="text-finance-blue">{formatWon(data.filteredTotals.income)}원</strong></span>
            <span>지출 <strong className="text-finance-red">{formatWon(data.filteredTotals.expense)}원</strong></span>
            <span>저축 납입 <strong className="text-finance-green">{formatWon(data.filteredTotals.saving)}원</strong></span>
          </div>
          <LedgerTransactionsTable accounts={formOptions.accounts} categories={formOptions.categories} filters={filters} key={`${data.month}:${filters.account}:${filters.flow}:${filters.major}:${filters.q}`} month={data.month} rows={data.transactions} />
        </section>
      </main>
    </div>
  )
}
