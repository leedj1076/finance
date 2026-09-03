import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SubmitButton } from '@/components/submit-button'
import { categoryPageUrl } from '@/features/analytics/category-url'
import {
  hasLedgerFilters,
  ledgerUrl,
  parseLedgerFilters,
} from '@/features/ledger/filters'
import {
  getLedgerData,
  getLedgerFormOptions,
} from '@/features/ledger/queries'
import { LedgerFilterForm } from '@/features/ledger/ledger-filter-form'
import { LedgerTransactionsTable } from '@/features/ledger/ledger-transactions-table'
import { TransactionForm } from '@/features/ledger/transaction-form'
import { currentMonthInKorea, formatRate, formatWon } from '@/lib/finance'
import { getAuthContext, requireHousehold } from '@/lib/household'

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

function SummaryCard({
  label,
  value,
  tone,
  description,
}: {
  label: string
  value: string
  tone: 'neutral' | 'income' | 'expense' | 'saving'
  description?: string
}) {
  const toneClass = {
    neutral: 'text-finance-ink',
    income: 'text-finance-blue',
    expense: 'text-finance-red',
    saving: 'text-finance-green',
  }[tone]

  return (
    <article className="px-6 py-5 first:pl-0 last:pr-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-muted">{label}</p>
      <p className={`mt-2 text-xl font-semibold tracking-[-0.02em] ${toneClass}`}>{value}</p>
      {description && <p className="mt-2 text-xs text-finance-muted">{description}</p>}
    </article>
  )
}

export default async function LedgerPage({ searchParams }: LedgerPageProps) {
  const auth = await getAuthContext()
  if (!auth) redirect('/login')

  const household = await requireHousehold()
  if (!household) {
    return (
      <div className="min-h-screen bg-white">
        <AppHeader active="ledger" email={auth.email} />
        <main className="mx-auto max-w-3xl px-6 py-16">
          <section className="border-t border-finance-red py-6">
            <h1 className="text-xl font-semibold text-finance-ink">가구에 연결되지 않았습니다</h1>
            <p className="mt-3 text-[13px] leading-6 text-finance-muted">
              관리자에게 이 이메일 계정을 가족 가계부에 연결해 달라고 요청해 주세요.
            </p>
          </section>
        </main>
      </div>
    )
  }

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
  const maxCategoryAmount = data.topCategories[0]?.amount ?? 0
  const deltaIsUp = data.comparison.expenseDelta > 0
  const currentMonth = currentMonthInKorea()
  const defaultDate = data.month === currentMonth
    ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
    : `${data.month}-01`
  const majorOptions = [...new Set(formOptions.categories.map((category) => category.major))]
  const showReviewReminder = data.month === currentMonth
    && Number(defaultDate.slice(8, 10)) <= 7
    && !data.hasMonthlyBudget

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="ledger" email={auth.email} />
      <main className="mx-auto max-w-none px-5 pb-12 pt-10 sm:px-12">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">거래</p>
            <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">
              {data.month.replace('-', '년 ')}월
            </h1>
            <p className="mt-2 text-xs text-finance-muted">거래 {data.transactions.length}건</p>
          </div>
          <div className="flex items-center border border-finance-ink">
            <Link
              aria-label="이전 달"
              className="grid h-8 w-[34px] place-items-center border-r border-finance-ink text-[13px] hover:bg-finance-track"
              href={ledgerUrl(data.previousMonth, filters)}
            >
              ←
            </Link>
            <form action="/ledger" className="flex h-8 items-center">
              {filters.account && <input name="account" type="hidden" value={filters.account} />}
              {filters.flow && <input name="flow" type="hidden" value={filters.flow} />}
              {filters.major && <input name="major" type="hidden" value={filters.major} />}
              {filters.q && <input name="q" type="hidden" value={filters.q} />}
              <input
                aria-label="조회 월"
                className="h-8 w-[124px] border-0 bg-white px-2 text-center text-[13px] font-semibold text-finance-ink outline-none"
                defaultValue={data.month}
                max={data.latestMonth}
                name="month"
                type="month"
              />
              <SubmitButton
                className="h-8 border-l border-finance-ink bg-finance-ink px-3 text-xs font-semibold text-white hover:bg-finance-blue"
                pendingLabel="불러오는 중…"
                type="submit"
              >
                보기
              </SubmitButton>
            </form>
            <Link
              aria-label="다음 달"
              className="grid h-8 w-[34px] place-items-center border-l border-finance-ink text-[13px] hover:bg-finance-track"
              href={ledgerUrl(data.nextMonth, filters)}
            >
              →
            </Link>
          </div>
        </div>

        {(recurringAdded !== null || data.pendingInboxCount > 0 || showReviewReminder || data.unclassifiedCount > 0 || data.overBudget.length > 0) && (
        <section className="mt-6 border-t border-finance-ink">
          {recurringAdded !== null && Number.isInteger(recurringAdded) && (
            <p className="flex min-h-11 items-center gap-3 border-b border-finance-border py-3 text-[13px]">
              <span aria-hidden className="h-[7px] w-[7px] shrink-0 bg-finance-green" />
              <span><strong>정기거래 {recurringAdded}건을 추가했습니다.</strong>{recurringSkipped !== null && recurringSkipped > 0 ? ` 이미 반영된 ${recurringSkipped}건은 건너뛰었습니다.` : ''}</span>
            </p>
          )}
          {data.pendingInboxCount > 0 && (
            <div className="flex min-h-11 items-center gap-3 border-b border-finance-border py-3 text-[13px]">
              <span aria-hidden className="h-[7px] w-[7px] shrink-0 bg-finance-blue" />
              <p><strong>인박스에 확인할 거래 {data.pendingInboxCount}건</strong>이 기다리고 있습니다.</p>
              <Link className="ml-auto shrink-0 text-xs font-semibold text-finance-blue" href="/inbox">분류하러 가기 →</Link>
            </div>
          )}
          {showReviewReminder && (
            <div className="flex min-h-11 items-center gap-3 border-b border-finance-border py-3 text-[13px]">
              <span aria-hidden className="h-[7px] w-[7px] shrink-0 bg-finance-amber" />
              <p><strong>이번 달 예산이 아직 없습니다.</strong> 지난달을 돌아보고 이번 달 계획을 세워보세요.</p>
              <Link className="ml-auto shrink-0 text-xs font-semibold text-finance-blue" href={`/budgets/review?month=${data.previousMonth}`}>월말 리뷰 시작 →</Link>
            </div>
          )}
          {data.unclassifiedCount > 0 && (
            <div className="flex min-h-11 items-center gap-3 border-b border-finance-border py-3 text-[13px]">
              <span aria-hidden className="h-[7px] w-[7px] shrink-0 bg-finance-amber" />
              <p><strong>미분류 거래 {data.unclassifiedCount}건</strong>이 있어 분석 정확도가 낮아질 수 있습니다.</p>
              <Link className="ml-auto shrink-0 text-xs font-semibold text-finance-blue" href="/manage?tab=unclassified">한꺼번에 분류 →</Link>
            </div>
          )}
          {data.overBudget.length > 0 && (
          <div className="flex min-h-11 items-center gap-3 border-b border-finance-border py-3 text-[13px]">
            <span aria-hidden className="h-[7px] w-[7px] shrink-0 bg-finance-red" />
            <p className="text-finance-muted">
              <strong>예산 초과</strong> {data.overBudget.length}개 분류 ·{' '}
              {data.overBudget.slice(0, 3).map((item) => (
                `${item.major} (+${formatWon(item.overrun)}원)`
              )).join(', ')}
            </p>
            <Link className="ml-auto shrink-0 text-xs font-semibold text-finance-blue" href={`/budgets?month=${data.month}`}>
              예산 보기 →
            </Link>
          </div>
          )}
        </section>
        )}

        <div className="mt-6 flex gap-1.5 overflow-x-auto border-b border-finance-border pb-4">
          {data.availableMonths.map((item) => (
            <Link
              className={`inline-flex h-[30px] shrink-0 items-center border px-3.5 text-xs font-medium ${
                item.month === data.month
                  ? 'border-finance-ink bg-finance-ink font-semibold text-white'
                  : 'border-finance-border bg-white text-finance-muted hover:border-finance-ink hover:text-finance-ink'
              }`}
              href={ledgerUrl(item.month, filters)}
              key={item.month}
            >
              {item.month} · {item.count}건
            </Link>
          ))}
        </div>

        {!anyFilter && data.safeToSpend?.hasIncome && (
          <section className="grid border-b border-finance-border border-t border-finance-ink sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] sm:divide-x sm:divide-finance-border">
            <div className="py-6 pr-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-muted">이번 달 더 쓸 수 있는 돈</p>
              <p className={`mt-2.5 text-[34px] font-bold leading-none tracking-[-0.03em] ${data.safeToSpend.remaining < 0 ? 'text-finance-red' : 'text-finance-green'}`}>
                {formatWon(data.safeToSpend.remaining)}<span className="text-base font-medium text-finance-muted"> 원</span>
              </p>
              <p className="mt-2 text-xs text-finance-muted">
                남은 {data.safeToSpend.daysLeft}일 기준 하루 <strong className="text-finance-ink">{formatWon(data.safeToSpend.daily)}원</strong> · 지출 상한 {formatWon(data.safeToSpend.ceiling)}원
              </p>
            </div>
            <div className="px-6 py-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-muted">월말 지출 예측 <span className="normal-case tracking-normal text-finance-faint">{data.forecast.basis === 'run_rate' ? 'run-rate' : '월평균'}</span></p>
              <p className="mt-2.5 text-[22px] font-semibold leading-none tracking-[-0.02em] text-finance-ink">{formatWon(data.forecast.projected)}<span className="text-sm font-medium text-finance-muted"> 원</span></p>
              <div className="relative mt-3 h-[5px] bg-finance-track">
                <div className="h-[5px] bg-finance-ink" style={{ width: `${Math.min((data.forecast.projected / Math.max(data.safeToSpend.ceiling, 1)) * 100, 100)}%` }} />
                <span className="absolute -top-[3px] right-0 h-[11px] w-px bg-finance-red" />
              </div>
              <p className="mt-2 text-[11px] text-finance-muted">
                상한 대비 {data.forecast.projected > data.safeToSpend.ceiling ? '초과' : '여유'} {formatWon(Math.abs(data.safeToSpend.ceiling - data.forecast.projected))}원
              </p>
            </div>
            <div className="py-6 pl-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-muted">이번 달 순저축률</p>
              <p className={`mt-2.5 text-[22px] font-bold leading-none tracking-[-0.02em] ${data.totals.savingsRate >= data.safeToSpend.rate ? 'text-finance-green' : 'text-finance-red'}`}>{formatRate(data.totals.savingsRate)}%</p>
              <p className="mt-2 text-xs text-finance-muted">목표 {data.safeToSpend.rate}% · 수입 {formatWon(data.totals.income)}원 · 지출 {formatWon(data.totals.expense)}원</p>
            </div>
          </section>
        )}

        <section className={`${!anyFilter && data.safeToSpend?.hasIncome ? '' : 'border-t border-finance-ink'} grid divide-y divide-finance-border border-b border-finance-ink sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4`}>
          <SummaryCard label="수입" tone="income" value={`${formatWon(data.totals.income)}원`} />
          <SummaryCard label="지출" tone="expense" value={`${formatWon(data.totals.expense)}원`} />
          <SummaryCard
            description={`순저축 ${formatWon(data.totals.netSaving)}원`}
            label="순저축률"
            tone="saving"
            value={`${formatRate(data.totals.savingsRate)}%`}
          />
          <SummaryCard
            description="적금·투자 납입액 · 순저축률과 별도"
            label="저축 납입"
            tone="neutral"
            value={`${formatWon(data.totals.saving)}원`}
          />
        </section>

        {!anyFilter && data.forecast.isCurrentMonth && !data.safeToSpend?.hasIncome && (
          <section className="flex flex-col gap-2 border-b border-finance-border py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-finance-ink">
              <span className="mr-2 bg-finance-track px-2 py-1 text-[10px] font-semibold text-finance-muted">예상</span>
              이달 예상 지출 <strong>{formatWon(data.forecast.projected)}원</strong>
            </p>
            <p className="text-xs text-finance-muted">
              {data.forecast.basis === 'run_rate'
                ? `현재 지출 속도 기준 · ${data.forecast.elapsed}/${data.forecast.daysInMonth}일 경과 (지금까지 ${formatWon(data.forecast.mtd)}원)`
                : '과거 월평균 기준 · 입력이 쌓이면 자동 보정'}
              {data.forecast.budget > 0
                ? ` · 예산 대비 ${data.forecast.projected > data.forecast.budget ? '+' : ''}${formatWon(data.forecast.projected - data.forecast.budget)}원`
                : ''}
            </p>
          </section>
        )}

        {!anyFilter && data.insights.length > 0 && (
          <section className="border-b border-finance-border py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-muted">이번 달 분석 · 지난달 대비</p>
            <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
              {data.insights.map((insight, index) => {
                const classes = insight.tone === 'expense'
                  ? 'bg-finance-red'
                  : insight.tone === 'saving'
                    ? 'bg-finance-green'
                    : 'bg-finance-faint'
                const content = <span className="flex items-start gap-2.5 border-b border-finance-track py-2 text-xs text-finance-ink"><span aria-hidden className={`mt-1 h-1.5 w-1.5 shrink-0 ${classes}`} />{insight.text}</span>
                return insight.major
                  ? <Link href={categoryPageUrl({ flow: 'expense', major: insight.major, period: { month: data.month } })} key={`${insight.text}-${index}`}>{content}</Link>
                  : <span key={`${insight.text}-${index}`}>{content}</span>
              })}
            </div>
          </section>
        )}

        <TransactionForm
          accounts={formOptions.accounts}
          categories={formOptions.categories}
          defaultDate={defaultDate}
          editing={null}
          filters={filters}
          month={data.month}
        />

        <section className="mt-6 space-y-6">
          <article>
            <div className="flex items-baseline justify-between border-t border-finance-ink pt-4">
              <div>
                <h2 className="text-sm font-bold text-finance-ink">거래 내역 <span className="ml-1 text-xs font-normal text-finance-muted">{data.transactions.length}건</span></h2>
              </div>
              <span className="text-[11px] text-finance-faint">최근순</span>
            </div>
            <LedgerFilterForm accounts={formOptions.accounts} filters={filters} majorOptions={majorOptions} month={data.month} />
            <LedgerTransactionsTable accounts={formOptions.accounts} categories={formOptions.categories} filters={filters} key={`${data.month}:${filters.account}:${filters.flow}:${filters.major}:${filters.q}`} month={data.month} rows={data.transactions} />
          </article>

          <div className="grid gap-12 border-b border-finance-border py-6 sm:grid-cols-2">
            <article>
              <p className="text-sm font-bold text-finance-ink">전월 대비 지출</p>
              <p
                className={`mt-2 text-[26px] font-semibold tracking-[-0.02em] ${deltaIsUp ? 'text-finance-red' : 'text-finance-green'}`}
              >
                {data.comparison.expenseDelta === 0
                  ? '변동 없음'
                  : `${deltaIsUp ? '+' : '−'}${formatWon(Math.abs(data.comparison.expenseDelta))}원`}
              </p>
              <p className="mt-2 text-xs text-finance-muted">
                {data.previousMonth} 지출 {formatWon(data.comparison.previousExpense)}원
                {data.comparison.expenseDeltaRate !== null && (
                  <>
                    {' '}
                    · {deltaIsUp ? '+' : ''}
                    {formatRate(data.comparison.expenseDeltaRate)}%
                  </>
                )}
              </p>
            </article>

            <article>
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-bold text-finance-ink">어디서 많이 썼나</h2>
                <span className="text-xs text-finance-muted">지출 대분류</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {data.topCategories.slice(0, 6).map((category, index) => (
                  <div key={category.major}>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-medium text-finance-ink">
                        {index + 1}. {category.major}
                      </span>
                      <span className="shrink-0 font-semibold text-finance-ink">
                        {formatWon(category.amount)}원
                      </span>
                    </div>
                    <div className="mt-[5px] h-[5px] bg-finance-track">
                      <div
                        className="h-full bg-finance-ink"
                        style={{
                          width: `${maxCategoryAmount > 0 ? (category.amount / maxCategoryAmount) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                {data.topCategories.length === 0 && (
                  <p className="text-[13px] text-finance-muted">이 달의 지출이 없습니다.</p>
                )}
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  )
}
