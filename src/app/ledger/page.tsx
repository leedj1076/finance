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
    neutral: 'text-zinc-950',
    income: 'text-blue-700',
    expense: 'text-rose-700',
    saving: 'text-emerald-700',
  }[tone]

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
      {description && <p className="mt-2 text-xs text-zinc-500">{description}</p>}
    </article>
  )
}

export default async function LedgerPage({ searchParams }: LedgerPageProps) {
  const auth = await getAuthContext()
  if (!auth) redirect('/login')

  const household = await requireHousehold()
  if (!household) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <AppHeader active="ledger" email={auth.email} />
        <main className="mx-auto max-w-3xl px-6 py-16">
          <section className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-semibold text-zinc-950">가구에 연결되지 않았습니다</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
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
    <div className="min-h-screen bg-zinc-50">
      <AppHeader active="ledger" email={auth.email} />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-emerald-700">월별 가계부</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">
              {data.month.replace('-', '년 ')}월
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              aria-label="이전 달"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50"
              href={ledgerUrl(data.previousMonth, filters)}
            >
              ←
            </Link>
            <form action="/ledger" className="flex items-center gap-2">
              {filters.account && <input name="account" type="hidden" value={filters.account} />}
              {filters.flow && <input name="flow" type="hidden" value={filters.flow} />}
              {filters.major && <input name="major" type="hidden" value={filters.major} />}
              {filters.q && <input name="q" type="hidden" value={filters.q} />}
              <input
                aria-label="조회 월"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800"
                defaultValue={data.month}
                max={data.latestMonth}
                name="month"
                type="month"
              />
              <SubmitButton
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
                pendingLabel="불러오는 중…"
                type="submit"
              >
                보기
              </SubmitButton>
            </form>
            <Link
              aria-label="다음 달"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50"
              href={ledgerUrl(data.nextMonth, filters)}
            >
              →
            </Link>
          </div>
        </div>

        {recurringAdded !== null && Number.isInteger(recurringAdded) && (
          <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            정기거래 {recurringAdded}건을 추가했습니다.
            {recurringSkipped !== null && recurringSkipped > 0 ? ` 이미 반영된 ${recurringSkipped}건은 건너뛰었습니다.` : ''}
          </p>
        )}

        <div className="mt-5 space-y-2">
          {data.pendingInboxCount > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between">
              <p><strong>인박스에 확인할 거래 {data.pendingInboxCount}건</strong>이 기다리고 있습니다.</p>
              <Link className="shrink-0 font-semibold underline underline-offset-2" href="/inbox">분류하러 가기 →</Link>
            </div>
          )}
          {showReviewReminder && (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <p><strong>이번 달 예산이 아직 없습니다.</strong> 지난달을 돌아보고 이번 달 계획을 세워보세요.</p>
              <Link className="shrink-0 font-semibold underline underline-offset-2" href={`/budgets/review?month=${data.previousMonth}`}>월말 리뷰 시작 →</Link>
            </div>
          )}
          {data.unclassifiedCount > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900 sm:flex-row sm:items-center sm:justify-between">
              <p><strong>미분류 거래 {data.unclassifiedCount}건</strong>이 있어 분석 정확도가 낮아질 수 있습니다.</p>
              <Link className="shrink-0 font-semibold underline underline-offset-2" href="/manage?tab=unclassified">한꺼번에 분류 →</Link>
            </div>
          )}
        </div>

        {data.overBudget.length > 0 && (
          <div className="mt-5 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 sm:flex-row sm:items-center sm:justify-between">
            <p>
              <strong>예산 초과</strong> {data.overBudget.length}개 분류 ·{' '}
              {data.overBudget.slice(0, 3).map((item) => (
                `${item.major} (+${formatWon(item.overrun)}원)`
              )).join(', ')}
            </p>
            <Link className="shrink-0 font-medium underline underline-offset-2" href={`/budgets?month=${data.month}`}>
              예산 보기 →
            </Link>
          </div>
        )}

        <div className="mt-6 flex gap-2 overflow-x-auto pb-2">
          {data.availableMonths.map((item) => (
            <Link
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                item.month === data.month
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400'
              }`}
              href={ledgerUrl(item.month, filters)}
              key={item.month}
            >
              {item.month} · {item.count}건
            </Link>
          ))}
        </div>

        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

        {!anyFilter && data.safeToSpend?.hasIncome && (
          <section className={`mt-5 grid gap-5 rounded-2xl border p-5 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
            data.safeToSpend.remaining < 0
              ? 'border-rose-200 bg-rose-50'
              : 'border-emerald-200 bg-emerald-50'
          }`}>
            <div>
              <p className="text-sm font-medium text-zinc-600">
                이번 달 더 쓸 수 있는 돈 · 저축률 {data.safeToSpend.rate}% 목표 기준
              </p>
              <p className={`mt-2 text-3xl font-semibold tracking-tight ${
                data.safeToSpend.remaining < 0 ? 'text-rose-800' : 'text-emerald-800'
              }`}>
                {formatWon(data.safeToSpend.remaining)}원
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-sm text-zinc-700">
                하루 <strong>{formatWon(data.safeToSpend.daily)}원</strong> · {data.safeToSpend.daysLeft}일 남음
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                상한 {formatWon(data.safeToSpend.ceiling)}원 · 사용 {formatWon(data.safeToSpend.mtd)}원 · 월말 예상{' '}
                {formatWon(data.forecast.projected)}원
              </p>
            </div>
          </section>
        )}

        {!anyFilter && data.forecast.isCurrentMonth && !data.safeToSpend?.hasIncome && (
          <section className="mt-5 flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-700">
              <span className="mr-2 rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium">예상</span>
              이달 예상 지출 <strong>{formatWon(data.forecast.projected)}원</strong>
            </p>
            <p className="text-xs text-zinc-500">
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
          <section className="mt-5 rounded-lg border border-zinc-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-1 text-xs font-semibold text-zinc-500">이번 달 분석 · 지난달 대비</p>
              {data.insights.map((insight, index) => {
                const classes = insight.tone === 'expense'
                  ? 'border-rose-200 bg-rose-50 text-rose-800'
                  : insight.tone === 'saving'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-700'
                const content = <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-medium ${classes}`}>{insight.text}</span>
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

        <section className="mt-6 space-y-5">
          <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-zinc-950">거래 내역</h2>
                <p className="mt-1 text-xs text-zinc-500">{data.transactions.length}건</p>
              </div>
              <span className="text-xs text-zinc-400">최근순</span>
            </div>
            <LedgerFilterForm accounts={formOptions.accounts} filters={filters} majorOptions={majorOptions} month={data.month} />
            <LedgerTransactionsTable accounts={formOptions.accounts} categories={formOptions.categories} filters={filters} month={data.month} rows={data.transactions} />
          </article>

          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">전월 대비 지출</p>
              <p
                className={`mt-2 text-2xl font-semibold ${deltaIsUp ? 'text-rose-700' : 'text-emerald-700'}`}
              >
                {data.comparison.expenseDelta === 0
                  ? '변동 없음'
                  : `${deltaIsUp ? '+' : '−'}${formatWon(Math.abs(data.comparison.expenseDelta))}원`}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
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

            <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-zinc-950">어디서 많이 썼나</h2>
                <span className="text-xs text-zinc-400">지출 대분류</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {data.topCategories.slice(0, 6).map((category, index) => (
                  <div key={category.major}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-zinc-700">
                        {index + 1}. {category.major}
                      </span>
                      <span className="shrink-0 font-medium text-zinc-950">
                        {formatWon(category.amount)}원
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full rounded-full bg-emerald-600"
                        style={{
                          width: `${maxCategoryAmount > 0 ? (category.amount / maxCategoryAmount) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                {data.topCategories.length === 0 && (
                  <p className="text-sm text-zinc-500">이 달의 지출이 없습니다.</p>
                )}
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  )
}
