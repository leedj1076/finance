import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import {
  CashflowWaterfall,
  SavingsProgressRing,
  SavingsRateChart,
  Sparkline,
} from '@/features/analytics/home-dashboard-charts'
import { getHomeTodos } from '@/features/analytics/home-todos'
import { MonthlyCashflowChart } from '@/features/analytics/monthly-cashflow-chart'
import { getNetWorthSeries } from '@/features/analytics/net-worth'
import { getDashboardData } from '@/features/analytics/queries'
import { NetWorthChart } from '@/features/assets/net-worth-chart'
import { currentMonthInKorea, formatRate, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

const TODO_TONES = {
  anomaly: 'bg-finance-red',
  pace: 'bg-finance-amber',
  inbox: 'bg-finance-blue',
  unclassified: 'bg-finance-amber',
  review: 'bg-finance-blue',
  recurring: 'bg-finance-muted',
} as const

function BudgetBullet({
  major,
  actual,
  budget,
  pacePercent,
  isFast,
}: {
  major: string
  actual: number
  budget: number
  pacePercent: number
  isFast: boolean
}) {
  const scale = Math.max(actual, budget, 1) * 1.06
  const actualPercent = Math.min((actual / scale) * 100, 100)
  const budgetPercent = Math.min((budget / scale) * 100, 100)
  const paceWidth = Math.min((budget * pacePercent / 100 / scale) * 100, 100)
  const exceeded = budget > 0 && actual > budget
  const usedPercent = budget > 0 ? (actual / budget) * 100 : null
  return (
    <div className="grid items-center gap-2 t-body sm:grid-cols-[110px_minmax(180px,1fr)_180px_100px] sm:gap-5">
      <strong className="truncate text-finance-ink">{major}</strong>
      <div className="relative h-[22px] bg-finance-panel">
        <span className="absolute inset-y-0 left-0 bg-finance-track" style={{ width: `${paceWidth}%` }} />
        <span className={`absolute left-0 top-[5px] h-3 ${exceeded ? 'bg-finance-red' : 'bg-finance-ink'}`} style={{ width: `${actualPercent}%` }} />
        {budget > 0 && <span className="absolute -top-[3px] h-7 w-0.5 bg-finance-ink" style={{ left: `${budgetPercent}%` }} />}
      </div>
      <span className="text-right tabular-nums"><strong>{formatWon(actual)}</strong> <span className="text-finance-faint">/ {budget > 0 ? formatWon(budget) : '미설정'}</span></span>
      <span className={`text-right font-semibold ${exceeded ? 'text-finance-red' : isFast ? 'text-finance-amber' : 'text-finance-green'}`}>
        {usedPercent === null ? '예산 없음' : `${Math.round(usedPercent)}%${exceeded ? ' 초과' : isFast ? ' · 빠름' : ' · 여유'}`}
      </span>
    </div>
  )
}

export default async function DashboardPage() {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const month = currentMonthInKorea()
  const year = Number(month.slice(0, 4))
  const [data, todos, netWorth] = await Promise.all([
    getDashboardData(household.householdId, year, month),
    getHomeTodos(household.householdId),
    getNetWorthSeries(household.householdId, 12),
  ])
  const visibleTodos = todos.slice(0, 3)
  const latestNetWorth = netWorth.at(-1)
  const previousNetWorth = netWorth.at(-2)
  const netWorthDelta = latestNetWorth && previousNetWorth
    ? latestNetWorth.netWorth - previousNetWorth.netWorth
    : null
  const budgetRows = data.budget.categories
    .filter((row) => row.budget > 0 || row.amount > 0)
    .slice(0, 6)
  const fastMajors = new Set(data.budget.paceWarnings.map((warning) => warning.major))
  const monthIndex = Number(month.slice(5, 7)) - 1
  const trendStart = Math.max(0, monthIndex - 5)
  const categoryRows = data.categoryRanks.slice(0, 6).map((rank) => {
    const values = (data.categoryMonthly.expense.series[rank.major] ?? [])
      .slice(trendStart, monthIndex + 1)
      .map((value) => value ?? 0)
    const populated = values.filter((value) => value > 0)
    const average = populated.length > 0
      ? Math.round(populated.reduce((sum, value) => sum + value, 0) / populated.length)
      : 0
    return { rank, values, average, merchant: data.largestMerchantByCategory[rank.major] }
  })
  const activeMonths = data.monthly.filter((row) => row.active && row.month <= month)
  const targetReached = activeMonths.filter((row) => row.income > 0 && row.savingsRate >= data.savingsTarget)
  const bestMonth = [...activeMonths].filter((row) => row.income > 0).sort((a, b) => b.savingsRate - a.savingsRate)[0]
  const worstMonth = [...activeMonths].filter((row) => row.income > 0).sort((a, b) => a.savingsRate - b.savingsRate)[0]

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="dashboard" email={household.email} />
      <main className="mx-auto max-w-[1440px] px-5 pb-14 pt-9 sm:px-12">
        <header>
          <p className="t-label uppercase text-finance-blue">이번 달</p>
          <h1 className="mt-2 t-page-title text-finance-ink">홈</h1>
          <p className="mt-2 t-caption text-finance-muted">
            {year}년 {Number(month.slice(5))}월 · {data.pace.elapsed}일 경과 / {data.pace.daysInMonth}일 · 모든 수치는 <strong className="font-semibold text-finance-ink">월 단위</strong>
            {' · '}지난 달은 <Link className="font-semibold text-finance-blue" href={`/ledger?month=${data.previousMonth}&tab=list`}>거래</Link>, 다른 해는 <Link className="font-semibold text-finance-blue" href="/report">연간</Link>에서
          </p>
        </header>

        <section className="mt-6 grid border-y border-finance-ink lg:grid-cols-3 lg:divide-x lg:divide-finance-border">
          <article className="flex min-h-[202px] items-center gap-6 border-b border-finance-border py-6 lg:border-b-0 lg:pr-8">
            <SavingsProgressRing target={data.savingsTarget} value={data.current.savingsRate} />
            <div>
              <p className="t-label uppercase text-finance-muted">목표대로 가고 있나</p>
              <h2 className="mt-2 t-section text-finance-ink">이번 달 순저축률</h2>
              <p className="mt-2 t-caption text-finance-muted">
                {data.current.income > 0
                  ? `수입 ${formatWon(data.current.income)}원 − 지출 ${formatWon(data.current.expense)}원`
                  : '이번 달 수입을 입력하면 목표와 비교합니다.'}
              </p>
            </div>
          </article>

          <article className="min-h-[202px] border-b border-finance-border py-7 lg:border-b-0 lg:px-8">
            <p className="t-label uppercase text-finance-muted">이번 달 더 써도 되나</p>
            {data.safeToSpend?.hasIncome ? (
              <>
                <p className={`mt-4 t-hero ${data.safeToSpend.remaining >= 0 ? 'text-finance-green' : 'text-finance-red'}`}>
                  {data.safeToSpend.remaining < 0 && '−'}{formatWon(Math.abs(data.safeToSpend.remaining))}<span className="ml-1 t-body font-medium text-finance-muted">원</span>
                </p>
                <p className="mt-3 t-caption text-finance-muted">
                  {data.safeToSpend.remaining >= 0 ? '저축 목표를 지키며 더 쓸 수 있는 돈' : '저축 목표 기반 지출 상한을 넘었습니다'}
                </p>
                <p className="mt-2 t-caption text-finance-faint">
                  남은 {data.safeToSpend.daysLeft}일 · 하루 {formatWon(data.safeToSpend.daily)}원 · 월말 예상 {formatWon(data.forecast.projected)}원
                </p>
              </>
            ) : (
              <div className="mt-7 border-l-2 border-finance-faint pl-4">
                <p className="t-body-strong text-finance-ink">수입 기록이 필요합니다</p>
                <p className="mt-2 t-caption text-finance-muted">완료된 달의 수입이 쌓이면 저축 목표 기반 지출 상한을 계산합니다.</p>
              </div>
            )}
          </article>

          <Link className="block min-h-[202px] py-7 lg:pl-8" href="/assets">
            <p className="t-label uppercase text-finance-muted">자산이 늘고 있나</p>
            {latestNetWorth ? (
              <>
                <p className="mt-4 t-hero text-finance-ink">{formatWon(latestNetWorth.netWorth)}<span className="ml-1 t-body font-medium text-finance-muted">원</span></p>
                <div className="mt-5 flex items-center justify-between gap-5">
                  <p className={`t-caption font-semibold ${netWorthDelta === null ? 'text-finance-muted' : netWorthDelta >= 0 ? 'text-finance-green' : 'text-finance-red'}`}>
                    {netWorthDelta === null ? '이전 달 비교 없음' : `전월보다 ${netWorthDelta >= 0 ? '+' : '−'}${formatWon(Math.abs(netWorthDelta))}원`}
                  </p>
                  <Sparkline tone={netWorthDelta === null ? 'neutral' : netWorthDelta >= 0 ? 'good' : 'bad'} values={netWorth.map((point) => point.netWorth)} />
                </div>
                <p className="mt-3 t-caption text-finance-faint">총자산 {formatWon(latestNetWorth.assets)}원 · 부채 {formatWon(latestNetWorth.liabilities)}원</p>
              </>
            ) : (
              <div className="mt-7 border-l-2 border-finance-faint pl-4">
                <p className="t-body-strong text-finance-ink">자산을 입력하면 추이가 보입니다</p>
                <p className="mt-2 t-caption text-finance-muted">자산 화면에서 잔고를 보정할 수 있습니다. →</p>
              </div>
            )}
          </Link>
        </section>

        <section aria-label="해야 할 일" className="border-b border-finance-border">
          {visibleTodos.length > 0 ? visibleTodos.map((todo) => (
            <Link className="flex min-h-12 flex-col gap-1 border-b border-finance-track py-3 t-body last:border-b-0 sm:flex-row sm:items-center sm:gap-3" href={todo.href} key={todo.kind}>
              <span aria-hidden className={`h-[7px] w-[7px] shrink-0 ${TODO_TONES[todo.kind]}`} />
              <strong className="text-finance-ink">{todo.title}</strong>
              <span className="t-caption text-finance-muted">{todo.detail}</span>
              <span className="ml-auto shrink-0 t-caption font-semibold text-finance-blue">확인 →</span>
            </Link>
          )) : (
            <p className="flex min-h-12 items-center gap-3 py-3 t-body text-finance-muted"><span aria-hidden className="h-[7px] w-[7px] bg-finance-green" />지금 바로 확인할 일은 없습니다.</p>
          )}
        </section>

        <section className="grid gap-10 border-b border-finance-border py-7 xl:grid-cols-[minmax(0,1.35fr)_minmax(440px,0.8fr)]">
          <article className="min-w-0">
            <div className="flex items-baseline justify-between">
              <div><h2 className="t-section text-finance-ink">순자산 추이</h2><p className="mt-1 t-caption text-finance-faint">최근 12개월 · 잔액이 없는 달은 직전 값 유지</p></div>
              <Link className="t-caption font-semibold text-finance-blue" href="/assets">자산 보기 →</Link>
            </div>
            {netWorth.length > 0 ? (
              <div className="mt-5 overflow-x-auto"><NetWorthChart data={netWorth.map((point) => ({ ...point, debt: point.liabilities, active: true }))} /></div>
            ) : (
              <p className="mt-5 grid min-h-[260px] place-items-center border-y border-finance-border t-body text-finance-muted">자산을 입력하면 12개월 추이가 보입니다.</p>
            )}
          </article>
          <article className="min-w-0 xl:border-l xl:border-finance-border xl:pl-10">
            <div><h2 className="t-section text-finance-ink">이번 달 돈의 흐름</h2><p className="mt-1 t-caption text-finance-faint">수입에서 지출과 저축 납입을 차례로 차감</p></div>
            {data.current.income + data.current.expense + data.current.saving > 0 ? (
              <div className="mt-5 overflow-x-auto"><CashflowWaterfall cashRemaining={data.current.cashRemaining} fixedExpense={data.current.fixedExpense} income={data.current.income} saving={data.current.saving} variableExpense={data.current.variableExpense} /></div>
            ) : (
              <p className="mt-5 grid min-h-[220px] place-items-center border-y border-finance-border t-body text-finance-muted">이번 달 거래를 입력하면 돈의 흐름이 보입니다.</p>
            )}
          </article>
        </section>

        <section className="border-b border-finance-border py-7">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div><h2 className="t-section text-finance-ink">예산 대비 지출</h2><p className="mt-1 t-caption text-finance-faint">막대 = 실제 · 세로선 = 예산 · 옅은 구간 = 오늘까지 적정 페이스({Math.round(data.pace.percent)}%)</p></div>
            <p className="t-caption text-finance-muted">대분류 예산 합계 <strong className="text-finance-ink">{formatWon(data.budget.total)}원</strong> 중 <strong className="text-finance-ink">{formatWon(data.budget.actual)}원</strong> 사용 · <strong>{data.budget.percent === null ? '예산 미설정' : `${formatRate(data.budget.percent)}%`}</strong></p>
          </div>
          {budgetRows.length > 0 ? (
            <div className="mt-5 space-y-4">
              {budgetRows.map((row) => <BudgetBullet actual={row.amount} budget={row.budget} isFast={fastMajors.has(row.major)} key={row.major} major={row.major} pacePercent={data.pace.percent} />)}
            </div>
          ) : (
            <p className="mt-5 grid min-h-24 place-items-center border-y border-finance-border t-body text-finance-muted">이번 달 예산이나 지출이 없습니다.</p>
          )}
        </section>

        <section className="border-b border-finance-border py-7">
          <div className="flex items-baseline justify-between gap-4">
            <div><h2 className="t-section text-finance-ink">카테고리별 추세</h2><p className="mt-1 t-caption text-finance-faint">최근 6개월 · 마지막 점이 이번 달</p></div>
            <Link className="t-caption font-semibold text-finance-blue" href={`/report?year=${year}`}>연간 › 항목별 월별 표 →</Link>
          </div>
          {categoryRows.length > 0 ? (
            <div className="mt-4 overflow-x-auto border-t border-finance-ink">
              <table className="w-full min-w-[820px] t-body">
                <thead className="border-b border-finance-border t-label uppercase text-finance-muted"><tr><th className="py-2.5 text-left">대분류</th><th className="px-3 py-2.5 text-right">이번 달</th><th className="px-3 py-2.5 text-center">6개월 추세</th><th className="px-3 py-2.5 text-right">6개월 평균</th><th className="px-3 py-2.5 text-right">전월 대비</th><th className="py-2.5 pl-5 text-left">가장 큰 지출처</th></tr></thead>
                <tbody className="divide-y divide-finance-track">
                  {categoryRows.map(({ rank, values, average, merchant }) => (
                    <tr key={rank.major}>
                      <th className="py-3 text-left font-semibold"><Link href={`/ledger?month=${month}&tab=categories&major=${encodeURIComponent(rank.major)}`}>{rank.major}</Link></th>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatWon(rank.amount)}</td>
                      <td className="px-3 py-3 text-center"><Sparkline tone={rank.delta > 0 ? 'bad' : rank.delta < 0 ? 'good' : 'neutral'} values={values} /></td>
                      <td className="px-3 py-3 text-right text-finance-muted tabular-nums">{formatWon(average)}</td>
                      <td className={`px-3 py-3 text-right tabular-nums ${rank.delta > 0 ? 'text-finance-red' : rank.delta < 0 ? 'text-finance-green' : 'text-finance-faint'}`}>{rank.delta === 0 ? '–' : `${rank.delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(rank.delta))}`}</td>
                      <td className="py-3 pl-5 text-left text-finance-muted">{merchant ? <>{merchant.name} <span className="text-finance-faint">{formatWon(merchant.amount)}</span></> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 grid min-h-24 place-items-center border-y border-finance-border t-body text-finance-muted">이번 달 카테고리 지출이 없습니다.</p>
          )}
        </section>

        <section className="grid gap-10 py-7 xl:grid-cols-[minmax(0,1.35fr)_minmax(420px,0.8fr)]">
          <article className="min-w-0">
            <div className="flex items-baseline justify-between"><div><h2 className="t-section text-finance-ink">월별 수입 · 지출</h2><p className="mt-1 t-caption text-finance-faint">{year}년 1~{Number(month.slice(5))}월 · 다른 해는 연간에서</p></div><Link className="t-caption font-semibold text-finance-blue" href="/report">연간 →</Link></div>
            <div className="mt-5 overflow-x-auto"><MonthlyCashflowChart data={data.monthly} /></div>
            <p className="mt-2 t-caption text-finance-muted">올해 누적 · 수입 <strong className="text-finance-blue">{formatWon(data.annual.income)}</strong> · 지출 <strong className="text-finance-ink">{formatWon(data.annual.expense)}</strong> · 순저축 <strong className="text-finance-green">{formatWon(data.annual.netSaving)}</strong></p>
          </article>
          <article className="min-w-0 xl:border-l xl:border-finance-border xl:pl-10">
            <div><h2 className="t-section text-finance-ink">월별 저축률</h2><p className="mt-1 t-caption text-finance-faint">점선 = 목표 {formatRate(data.savingsTarget)}% · 연 누적 {formatRate(data.annual.savingsRate)}%</p></div>
            <div className="mt-4 overflow-x-auto"><SavingsRateChart data={data.monthly} target={data.savingsTarget} /></div>
            <p className="mt-2 t-caption text-finance-muted">목표 달성 <strong className="text-finance-green">{targetReached.length}개월</strong>{bestMonth && <> · 최고 {Number(bestMonth.month.slice(5))}월 {formatRate(bestMonth.savingsRate)}%</>}{worstMonth && <> · 최저 {Number(worstMonth.month.slice(5))}월 {formatRate(worstMonth.savingsRate)}%</>}</p>
          </article>
        </section>
      </main>
    </div>
  )
}
