import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SubmitButton } from '@/components/submit-button'
import { getCategoryPageData, parseCategoryPageParams } from '@/features/analytics/category-page'
import { getAnalysisData } from '@/features/analytics/queries'
import { DiagnosisPanel } from '@/features/diagnosis/diagnosis-panel'
import { getDiagnosisPageData } from '@/features/diagnosis/queries'
import { hasLedgerFilters, ledgerUrl, parseLedgerAccountId, parseLedgerFilters } from '@/features/ledger/filters'
import {
  LedgerCategoriesPanel,
  LedgerMerchantsPanel,
  LedgerSummaryPanel,
} from '@/features/ledger/ledger-analysis-panels'
import { LedgerFilterForm } from '@/features/ledger/ledger-filter-form'
import { LedgerSortSelect } from '@/features/ledger/ledger-sort-select'
import { LedgerTransactionsTable } from '@/features/ledger/ledger-transactions-table'
import {
  LEDGER_ROW_LIMIT,
  getLedgerFormOptions,
  getLedgerShellData,
  getLedgerTransactions,
} from '@/features/ledger/queries'
import { TransactionForm } from '@/features/ledger/transaction-form'
import { applyRecurringMonth } from '@/features/recurring/actions'
import { getRecurringData } from '@/features/recurring/queries'
import { currentMonthInKorea, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type LedgerTab = 'summary' | 'list' | 'ai' | 'categories' | 'merchants'

type LedgerPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const TABS: Array<{ key: LedgerTab; label: string }> = [
  { key: 'summary', label: '요약' },
  { key: 'list', label: '목록' },
  { key: 'ai', label: 'AI 진단' },
  { key: 'categories', label: '카테고리' },
  { key: 'merchants', label: '가맹점' },
]

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parseTab(value: string | undefined): LedgerTab {
  return value === 'summary' || value === 'ai' || value === 'categories' || value === 'merchants'
    ? value
    : 'list'
}

export default async function LedgerPage({ searchParams }: LedgerPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const params = await searchParams
  const requestedMonth = firstParam(params.month)
  const tab = parseTab(firstParam(params.tab))
  // Diagnosis is a complete-month report, including when opened from a filtered tab.
  const filters = parseLedgerFilters(tab === 'ai' ? {} : params)
  const anyFilter = hasLedgerFilters(filters)
  const recurringAdded = firstParam(params.recurringAdded)
  const recurringSkipped = firstParam(params.recurringSkipped)

  const [shell, formOptions] = await Promise.all([
    getLedgerShellData(household.householdId, requestedMonth, filters),
    tab === 'ai' ? { accounts: [], categories: [] } : getLedgerFormOptions(household.householdId),
  ])
  const majorOptions = [...new Set(formOptions.categories.map((category) => category.major))]
  const selectedFlow = filters.flow || 'expense'

  // Load only the active panel; diagnosis also skips transaction-only controls.
  const [recurring, analysis, categoryDetail, listData, diagnosisData] = await Promise.all([
    tab === 'ai' ? null : getRecurringData(household.householdId, shell.month),
    tab === 'list' || tab === 'ai'
      ? null
      : getAnalysisData(household.householdId, {
        period: 'month',
        month: shell.month,
        flow: selectedFlow,
        accountId: parseLedgerAccountId(filters.account) ?? undefined,
        major: filters.major,
        q: filters.q,
      }),
    tab === 'categories' && filters.major
      ? getCategoryPageData(household.householdId, parseCategoryPageParams({
        period: 'month',
        month: shell.month,
        flow: selectedFlow,
        major: filters.major,
        account: filters.account,
      }))
      : null,
    tab === 'list' ? getLedgerTransactions(household.householdId, shell.month, filters) : null,
    tab === 'ai' ? getDiagnosisPageData(household.householdId, shell.month) : null,
  ])
  const recurringPending = recurring ? Math.max(recurring.activeCount - recurring.generatedCount, 0) : 0

  const currentMonth = currentMonthInKorea()
  const defaultDate = shell.month === currentMonth
    ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
    : `${shell.month}-01`

  return (
    <div className="min-h-screen bg-white">
      <div className={tab === 'ai' ? 'contents print:hidden' : 'contents'}><AppHeader active="ledger" email={household.email} /></div>
      <main className="mx-auto max-w-[1680px] px-5 pb-14 pt-9 sm:px-12 print:max-w-none print:px-0 print:pt-0">
        <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end print:hidden">
          <div>
            <p className="t-label uppercase text-finance-blue">월간 기록과 분석</p>
            <h1 className="mt-2 t-page-title text-finance-ink">내역</h1>
            <p className="mt-2 t-caption text-finance-muted">{tab === 'ai' ? '한 달의 기록을 바탕으로 우리집의 돈 흐름을 살펴봅니다' : '필터를 한 번 잡고 합계에서 거래 행까지 내려봅니다'}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {tab !== 'list' && <Link className="h-[34px] bg-finance-blue px-4 py-2 t-body-strong text-white hover:opacity-80" href={`${ledgerUrl(shell.month, filters, { tab: 'list' })}#transaction-form`}>거래 추가</Link>}
            <div className="flex items-center border border-finance-ink">
              <Link aria-label="이전 달" className="grid h-8 w-[34px] place-items-center border-r border-finance-ink t-body hover:bg-finance-track" href={ledgerUrl(shell.previousMonth, filters, { tab })}>←</Link>
              <form action="/ledger" className="flex h-8 items-center">
                <input name="tab" type="hidden" value={tab} />
                {filters.sort && <input name="sort" type="hidden" value={filters.sort} />}
                {filters.account && <input name="account" type="hidden" value={filters.account} />}
                {filters.flow && <input name="flow" type="hidden" value={filters.flow} />}
                {filters.major && <input name="major" type="hidden" value={filters.major} />}
                {filters.q && <input name="q" type="hidden" value={filters.q} />}
                <input aria-label="조회 월" className="h-8 w-[124px] border-0 bg-white px-2 text-center t-body-strong text-finance-ink outline-none" defaultValue={shell.month} key={shell.month} max={shell.latestMonth} name="month" type="month" />
                <SubmitButton className="h-8 border-l border-finance-ink bg-finance-ink px-3 t-body-strong text-white hover:bg-finance-blue" pendingLabel="불러오는 중…" type="submit">보기</SubmitButton>
              </form>
              <Link aria-label="다음 달" className="grid h-8 w-[34px] place-items-center border-l border-finance-ink t-body hover:bg-finance-track" href={ledgerUrl(shell.nextMonth, filters, { tab })}>→</Link>
            </div>
          </div>
        </header>

        <div className="mt-6 flex gap-1.5 overflow-x-auto border-b border-finance-border pb-4 print:hidden">
          {shell.availableMonths.map((item) => (
            <Link className={`inline-flex h-[30px] shrink-0 items-center border px-3.5 t-caption font-medium ${item.month === shell.month ? 'border-finance-ink bg-finance-ink font-semibold text-white' : 'border-finance-border bg-white text-finance-muted hover:border-finance-ink hover:text-finance-ink'}`} href={ledgerUrl(item.month, filters, { tab })} key={item.month}>
              {item.month} · {item.count}건
            </Link>
          ))}
        </div>

        {recurring && <section className="flex flex-col gap-3 border-b border-finance-border py-4 sm:flex-row sm:items-center">
          <span aria-hidden className={`h-[7px] w-[7px] shrink-0 ${recurringPending > 0 ? 'bg-finance-amber' : 'bg-finance-green'}`} />
          <p className="t-body text-finance-ink">
            <strong>{shell.month} 정기거래</strong> · 활성 {recurring.activeCount}건 중 {recurring.generatedCount}건 반영
            {recurringAdded && <span className="ml-2 text-finance-green">방금 {recurringAdded}건 추가{recurringSkipped ? ` · ${recurringSkipped}건 건너뜀` : ''}</span>}
          </p>
          <div className="ml-auto flex items-center gap-3">
            <Link className="t-caption font-semibold text-finance-muted hover:text-finance-blue" href="/recurring">규칙 설정</Link>
            {recurringPending > 0 && (
              <form action={applyRecurringMonth}>
                <input name="month" type="hidden" value={shell.month} />
                <input name="returnAccount" type="hidden" value={filters.account} />
                <input name="returnFlow" type="hidden" value={filters.flow} />
                <input name="returnMajor" type="hidden" value={filters.major} />
                <input name="returnQ" type="hidden" value={filters.q} />
                <input name="returnSort" type="hidden" value={filters.sort ?? 'date-desc'} />
                <input name="returnTab" type="hidden" value={tab} />
                <SubmitButton className="h-[30px] bg-finance-ink px-3.5 t-body-strong text-white hover:bg-finance-blue" pendingLabel="반영 중…" type="submit">미반영 {recurringPending}건 반영</SubmitButton>
              </form>
            )}
          </div>
        </section>}

        <nav aria-label="거래 보기" className="mt-6 flex overflow-x-auto border-b border-finance-ink print:hidden">
          {TABS.map((item) => (
            <Link aria-current={tab === item.key ? 'page' : undefined} className={`shrink-0 border-x border-t px-3 py-2.5 sm:px-5 t-body-strong first:border-l ${tab === item.key ? 'border-finance-ink bg-finance-ink text-white' : 'border-finance-hairline bg-white text-finance-muted hover:text-finance-ink'}`} href={ledgerUrl(shell.month, filters, { tab: item.key })} key={item.key}>{item.label}</Link>
          ))}
        </nav>

        {tab !== 'ai' && <>
          <LedgerFilterForm accounts={formOptions.accounts} filters={filters} key={`${shell.month}:${filters.account}:${filters.flow}:${filters.major}:${filters.q}`} majorOptions={majorOptions} month={shell.month} tab={tab} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-finance-ink py-3 t-caption text-finance-muted">
          <strong className="text-finance-ink">{anyFilter ? '현재 필터' : '이 달 전체'} · {shell.filteredTotals.count}건</strong>
          <span>수입 <strong className="text-finance-blue">{formatWon(shell.filteredTotals.income)}원</strong></span>
          <span>지출 <strong className="text-finance-red">{formatWon(shell.filteredTotals.expense)}원</strong></span>
          <span>저축 <strong className="text-finance-green">{formatWon(shell.filteredTotals.saving)}원</strong></span>
        </div>
        </>}

        {tab === 'ai' && diagnosisData && <DiagnosisPanel initialData={diagnosisData} key={shell.month} />}
        {tab === 'summary' && analysis && <LedgerSummaryPanel data={analysis} monthTotals={shell.totals} />}
        {tab === 'categories' && analysis && <LedgerCategoriesPanel data={analysis} detail={categoryDetail} filters={filters} />}
        {tab === 'merchants' && analysis && <LedgerMerchantsPanel data={analysis} filters={filters} />}
        {tab === 'list' && listData && (
          <>
            <div id="transaction-form"><TransactionForm accounts={formOptions.accounts} categories={formOptions.categories} defaultDate={defaultDate} editing={null} filters={filters} key={shell.month} month={shell.month} /></div>
            <section className="mt-6">
              <div className="flex items-baseline justify-between border-t border-finance-ink pt-4"><h2 className="t-section text-finance-ink">거래 내역</h2><LedgerSortSelect filters={filters} month={shell.month} /></div>
              {listData.truncated && (
                <p className="mt-3 border border-finance-amber px-3 py-2 t-caption text-finance-ink">
                  선택한 정렬 기준으로 앞 {LEDGER_ROW_LIMIT.toLocaleString('ko-KR')}건만 표시했습니다 · 위 합계는 필터에 걸린 {shell.filteredTotals.count}건 전체 기준입니다
                </p>
              )}
              <LedgerTransactionsTable accounts={formOptions.accounts} categories={formOptions.categories} filters={filters} key={`${shell.month}:${filters.account}:${filters.flow}:${filters.major}:${filters.q}`} month={shell.month} rows={listData.rows} />
            </section>
          </>
        )}
      </main>
    </div>
  )
}
