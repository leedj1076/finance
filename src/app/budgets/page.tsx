import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SubmitButton } from '@/components/submit-button'
import { BudgetForm } from '@/features/budgets/budget-form'
import { getBudgetData } from '@/features/budgets/queries'
import { currentMonthInKorea, formatRate, formatWon } from '@/lib/finance'
import { getAuthContext, requireHousehold } from '@/lib/household'

type BudgetsPageProps = {
  searchParams: Promise<{ month?: string | string[]; reviewSaved?: string | string[] }>
}

function SummaryCard({ label, value, tone = 'default' }: {
  label: string
  value: string
  tone?: 'default' | 'good' | 'warning'
}) {
  const color = tone === 'good'
    ? 'text-finance-green'
    : tone === 'warning'
      ? 'text-finance-red'
      : 'text-finance-ink'
  return (
    <article className="px-4 py-5 first:pl-0 last:pr-0 sm:px-6">
      <p className="t-label uppercase text-finance-muted">{label}</p>
      <p className={`mt-2 t-kpi tabular-nums ${color}`}>{value}</p>
    </article>
  )
}

export default async function BudgetsPage({ searchParams }: BudgetsPageProps) {
  const auth = await getAuthContext()
  if (!auth) redirect('/login')

  const household = await requireHousehold()
  if (!household) {
    return (
      <div className="min-h-screen bg-white">
        <AppHeader active="budgets" email={auth.email} />
        <main className="mx-auto max-w-3xl px-6 py-16">
          <section className="border-t border-finance-red py-8">
            <h1 className="t-page-title text-finance-ink">가구에 연결되지 않았습니다</h1>
          </section>
        </main>
      </div>
    )
  }

  const params = await searchParams
  const requestedMonth = typeof params.month === 'string' ? params.month : undefined
  const reviewSaved = params.reviewSaved === '1'
  const data = await getBudgetData(household.householdId, requestedMonth)
  const safeToSpend = data.spendCeiling - data.totalActual
  const remainingTone = safeToSpend < 0 ? 'warning' : 'good'
  const currentMonth = currentMonthInKorea()
  const isMonthEnd = data.month === currentMonth && Number(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(8, 10),
  ) >= 25
  const reviewNeedsAttention = isMonthEnd || !data.nextBudgetExists

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="budgets" email={auth.email} />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-14 pt-10 sm:px-12">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="t-label uppercase text-finance-blue">월별 계획</p>
            <h1 className="mt-2 t-page-title text-finance-ink">
              {data.month.replace('-', '년 ')}월 예산
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className={`h-[34px] whitespace-nowrap border px-3 py-2 t-body-strong ${reviewNeedsAttention
                ? 'border-finance-green bg-finance-green text-white hover:opacity-80'
                : 'border-finance-hairline bg-white text-finance-muted hover:border-finance-green hover:text-finance-green'}`}
              href={`/budgets/review?month=${data.nextMonth}`}
            >
              {reviewNeedsAttention ? '다음 달 예산 만들기 →' : '월말 리뷰 →'}
            </Link>
            <Link
              aria-label="이전 달"
              className="grid h-[34px] w-[34px] place-items-center border border-finance-hairline bg-white text-finance-ink hover:bg-finance-panel"
              href={`/budgets?month=${data.previousMonth}`}
            >
              ←
            </Link>
            <form action="/budgets" className="flex items-center gap-2">
              <input
                aria-label="예산 월"
                className="h-[34px] border border-finance-hairline bg-white px-3 t-body text-finance-ink"
                defaultValue={data.month}
                name="month"
                type="month"
              />
              <SubmitButton
                className="h-[34px] bg-finance-ink px-3 t-body-strong text-white hover:opacity-80"
                pendingLabel="불러오는 중…"
                type="submit"
              >
                보기
              </SubmitButton>
            </form>
            <Link
              aria-label="다음 달"
              className="grid h-[34px] w-[34px] place-items-center border border-finance-hairline bg-white text-finance-ink hover:bg-finance-panel"
              href={`/budgets?month=${data.nextMonth}`}
            >
              →
            </Link>
          </div>
        </div>

        {reviewSaved && <p className="mt-5 border-l-2 border-finance-green bg-finance-green-tint px-4 py-3 t-body text-finance-green">월말 리뷰에서 {data.month} 예산을 저장했습니다.</p>}

        <section className="mt-6 grid border-y border-finance-ink sm:grid-cols-3 sm:divide-x sm:divide-finance-hairline">
          <SummaryCard label="목표 지출 상한" value={`${formatWon(data.spendCeiling)}원`} />
          <SummaryCard
            label="이번 달 사용"
            tone={data.totalActual > data.spendCeiling ? 'warning' : 'default'}
            value={`${formatWon(data.totalActual)}원`}
          />
          <SummaryCard
            label={safeToSpend < 0 ? '목표 상한 초과' : '더 쓸 수 있는 돈'}
            tone={remainingTone}
            value={`${formatWon(Math.abs(safeToSpend))}원`}
          />
        </section>

        {data.paceWarnings.length > 0 && (
          <section className="mt-6 border-t border-finance-ink py-4">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <p className="flex items-center gap-2 t-section text-finance-ink"><span className="h-[7px] w-[7px] bg-finance-amber" />예산보다 빠르게 지출 중인 항목이 있습니다</p>
                <p className="mt-1 t-caption text-finance-muted">현재까지의 일평균 지출이 이어진다고 가정한 월말 예상입니다.</p>
              </div>
              <span className="w-fit bg-finance-amber-tint px-2 py-1 t-badge text-finance-amber">{data.paceWarnings.length}개 경고</span>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {data.paceWarnings.slice(0, 4).map((warning) => (
                <article className="border-b border-finance-hairline py-4" key={warning.major}>
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-medium text-finance-ink">{warning.major}</p><p className="mt-1 t-caption text-finance-muted">월 {formatRate(warning.progressPercent)}% 경과 · 예산 {formatRate(warning.spentPercent)}% 사용</p></div>
                    <span className="whitespace-nowrap t-body-strong text-finance-red">+{formatWon(warning.overrun)}원 예상</span>
                  </div>
                  <p className="mt-3 t-caption text-finance-muted">현재 {formatWon(warning.actual)}원 → 월말 약 {formatWon(warning.projected)}원</p>
                </article>
              ))}
            </div>
          </section>
        )}

        <BudgetForm
          averageExpense={data.averageExpense}
          averageIncome={data.averageIncome}
          currentSavingsRate={data.currentSavingsRate}
          month={data.month}
          rows={data.rows}
          savingsTarget={data.savingsTarget}
          spendCeiling={data.spendCeiling}
        />
      </main>
    </div>
  )
}
