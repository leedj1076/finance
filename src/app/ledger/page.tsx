import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SubmitButton } from '@/components/submit-button'
import { getCategoryPageData, parseCategoryPageParams } from '@/features/analytics/category-page'
import { getAnalysisData } from '@/features/analytics/queries'
import { hasLedgerFilters, ledgerUrl, parseLedgerAccountId, parseLedgerFilters } from '@/features/ledger/filters'
import {
  LedgerCategoriesPanel,
  LedgerMerchantsPanel,
  LedgerSummaryPanel,
} from '@/features/ledger/ledger-analysis-panels'
import { LedgerFilterForm } from '@/features/ledger/ledger-filter-form'
import { LedgerTransactionsTable } from '@/features/ledger/ledger-transactions-table'
import { getLedgerData, getLedgerFormOptions, getLedgerShellData } from '@/features/ledger/queries'
import { TransactionForm } from '@/features/ledger/transaction-form'
import { applyRecurringMonth } from '@/features/recurring/actions'
import { getRecurringData } from '@/features/recurring/queries'
import { currentMonthInKorea, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type LedgerTab = 'summary' | 'categories' | 'merchants' | 'list'

type LedgerPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const TABS: Array<{ key: LedgerTab; label: string }> = [
  { key: 'summary', label: '요약' },
  { key: 'categories', label: '카테고리' },
  { key: 'merchants', label: '가맹점' },
  { key: 'list', label: '목록' },
]

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parseTab(value: string | undefined): LedgerTab {
  return value === 'summary' || value === 'categories' || value === 'merchants'
    ? value
    : 'list'
}

export default async function LedgerPage({ searchParams }: LedgerPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const params = await searchParams
  const requestedMonth = firstParam(params.month)
  const filters = parseLedgerFilters(params)
  const tab = parseTab(firstParam(params.tab))
  const anyFilter = hasLedgerFilters(filters)
  const recurringAdded = firstParam(params.recurringAdded)
  const recurringSkipped = firstParam(params.recurringSkipped)

  const [shell, formOptions] = await Promise.all([
    getLedgerShellData(household.householdId, requestedMonth, filters),
    getLedgerFormOptions(household.householdId),
  ])
  const recurring = await getRecurringData(household.householdId, shell.month)
  const recurringPending = Math.max(recurring.activeCount - recurring.generatedCount, 0)
  const majorOptions = [...new Set(formOptions.categories.map((category) => category.major))]
  const selectedFlow = filters.flow || 'expense'

  const analysis = tab === 'list'
    ? null
    : await getAnalysisData(household.householdId, {
      period: 'month',
      month: shell.month,
      flow: selectedFlow,
      accountId: parseLedgerAccountId(filters.account) ?? undefined,
      major: filters.major,
      q: filters.q,
    })
  const categoryDetail = tab === 'categories' && filters.major
    ? await getCategoryPageData(household.householdId, parseCategoryPageParams({
      period: 'month',
      month: shell.month,
      flow: selectedFlow,
      major: filters.major,
      account: filters.account,
    }))
    : null
  const listData = tab === 'list'
    ? await getLedgerData(household.householdId, shell.month, filters)
    : null

  const currentMonth = currentMonthInKorea()
  const defaultDate = shell.month === currentMonth
    ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
    : `${shell.month}-01`

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="ledger" email={household.email} />
      <main className="mx-auto max-w-[1680px] px-5 pb-14 pt-9 sm:px-12">
        <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="t-label uppercase text-finance-blue">월간 기록과 분석</p>
            <h1 className="mt-2 t-page-title text-finance-ink">거래</h1>
            <p className="mt-2 t-caption text-finance-muted">필터를 한 번 잡고 합계에서 거래 행까지 내려봅니다</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {tab !== 'list' && <Link className="h-[34px] bg-finance-blue px-4 py-2 t-body-strong text-white hover:opacity-80" href={`${ledgerUrl(shell.month, filters, { tab: 'list' })}#transaction-form`}>거래 추가</Link>}
            <div className="flex items-center border border-finance-ink">
              <Link aria-label="이전 달" className="grid h-8 w-[34px] place-items-center border-r border-finance-ink t-body hover:bg-finance-track" href={ledgerUrl(shell.previousMonth, filters, { tab })}>←</Link>
              <form action="/ledger" className="flex h-8 items-center">
                <input name="tab" type="hidden" value={tab} />
                {filters.account && <input name="account" type="hidden" value={filters.account} />}
                {filters.flow && <input name="flow" type="hidden" value={filters.flow} />}
                {filters.major && <input name="major" type="hidden" value={filters.major} />}
                {filters.q && <input name="q" type="hidden" value={filters.q} />}
                <input aria-label="조회 월" className="h-8 w-[124px] border-0 bg-white px-2 text-center t-body-strong text-finance-ink outline-none" defaultValue={shell.month} max={shell.latestMonth} name="month" type="month" />
                <SubmitButton className="h-8 border-l border-finance-ink bg-finance-ink px-3 t-body-strong text-white hover:bg-finance-blue" pendingLabel="불러오는 중…" type="submit">보기</SubmitButton>
              </form>
              <Link aria-label="다음 달" className="grid h-8 w-[34px] place-items-center border-l border-finance-ink t-body hover:bg-finance-track" href={ledgerUrl(shell.nextMonth, filters, { tab })}>→</Link>
            </div>
          </div>
        </header>

        <div className="mt-6 flex gap-1.5 overflow-x-auto border-b border-finance-border pb-4">
          {shell.availableMonths.map((item) => (
            <Link className={`inline-flex h-[30px] shrink-0 items-center border px-3.5 t-caption font-medium ${item.month === shell.month ? 'border-finance-ink bg-finance-ink font-semibold text-white' : 'border-finance-border bg-white text-finance-muted hover:border-finance-ink hover:text-finance-ink'}`} href={ledgerUrl(item.month, filters, { tab })} key={item.month}>
              {item.month} · {item.count}건
            </Link>
          ))}
        </div>

        <section className="flex flex-col gap-3 border-b border-finance-border py-4 sm:flex-row sm:items-center">
          <span aria-hidden className={`h-[7px] w-[7px] shrink-0 ${recurringPending > 0 ? 'bg-finance-amber' : 'bg-finance-green'}`} />
          <p className="t-body text-finance-ink">
            <strong>{shell.month} 정기거래</strong> · 활성 {recurring.activeCount}건 중 {recurring.generatedCount}건 반영
            {recurringAdded && <span className="ml-2 text-finance-green">방금 {recurringAdded}건 추가{recurringSkipped ? ` · ${recurringSkipped}건 건너뜀` : ''}</span>}
          </p>
          <div className="ml-auto flex items-center gap-3">
            <Link className="t-caption font-semibold text-finance-muted hover:text-finance-blue" href="/settings?section=recurring">규칙 설정</Link>
            {recurringPending > 0 && (
              <form action={applyRecurringMonth}>
                <input name="month" type="hidden" value={shell.month} />
                <SubmitButton className="h-[30px] bg-finance-ink px-3.5 t-body-strong text-white hover:bg-finance-blue" pendingLabel="반영 중…" type="submit">미반영 {recurringPending}건 반영</SubmitButton>
              </form>
            )}
          </div>
        </section>

        <nav aria-label="거래 보기" className="mt-6 flex overflow-x-auto border-b border-finance-ink">
          {TABS.map((item) => (
            <Link aria-current={tab === item.key ? 'page' : undefined} className={`shrink-0 border-x border-t px-5 py-2.5 t-body-strong first:border-l ${tab === item.key ? 'border-finance-ink bg-finance-ink text-white' : 'border-finance-hairline bg-white text-finance-muted hover:text-finance-ink'}`} href={ledgerUrl(shell.month, filters, { tab: item.key })} key={item.key}>{item.label}</Link>
          ))}
        </nav>

        <LedgerFilterForm accounts={formOptions.accounts} filters={filters} majorOptions={majorOptions} month={shell.month} tab={tab} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-finance-ink py-3 t-caption text-finance-muted">
          <strong className="text-finance-ink">{anyFilter ? '현재 필터' : '이 달 전체'} · {shell.filteredTotals.count}건</strong>
          <span>수입 <strong className="text-finance-blue">{formatWon(shell.filteredTotals.income)}원</strong></span>
          <span>지출 <strong className="text-finance-red">{formatWon(shell.filteredTotals.expense)}원</strong></span>
          <span>저축 <strong className="text-finance-green">{formatWon(shell.filteredTotals.saving)}원</strong></span>
        </div>

        {tab === 'summary' && analysis && <LedgerSummaryPanel data={analysis} monthTotals={shell.totals} />}
        {tab === 'categories' && analysis && <LedgerCategoriesPanel data={analysis} detail={categoryDetail} filters={filters} />}
        {tab === 'merchants' && analysis && <LedgerMerchantsPanel data={analysis} filters={filters} />}
        {tab === 'list' && listData && (
          <>
            <div id="transaction-form"><TransactionForm accounts={formOptions.accounts} categories={formOptions.categories} defaultDate={defaultDate} editing={null} filters={filters} month={shell.month} /></div>
            <section className="mt-6">
              <div className="flex items-baseline justify-between border-t border-finance-ink pt-4"><h2 className="t-section text-finance-ink">거래 내역</h2><span className="t-caption text-finance-faint">최근순</span></div>
              <LedgerTransactionsTable accounts={formOptions.accounts} categories={formOptions.categories} filters={filters} key={`${shell.month}:${filters.account}:${filters.flow}:${filters.major}:${filters.q}`} month={shell.month} rows={listData.transactions} />
            </section>
          </>
        )}
      </main>
    </div>
  )
}
