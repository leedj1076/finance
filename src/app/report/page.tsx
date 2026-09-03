import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { AnnualFlowOverview } from '@/features/analytics/annual-flow-overview'
import { getCategoryDetails } from '@/features/analytics/category-detail'
import { SavingsProgressRing } from '@/features/analytics/home-dashboard-charts'
import { getDashboardData } from '@/features/analytics/queries'
import { getReportData } from '@/features/analytics/report'
import { StatsMonthlySection } from '@/features/analytics/stats-monthly-section'
import { parseStatsViewState, statsViewSearch } from '@/features/analytics/stats-monthly'
import { StatsYearSelector } from '@/features/analytics/stats-year-selector'
import { currentMonthInKorea, formatRate, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type ReportPageProps = {
  searchParams: Promise<{
    flow?: string | string[]
    axis?: string | string[]
    chart?: string | string[]
    major?: string | string[]
    year?: string | string[]
  }>
}

function signedWon(value: number) {
  if (value === 0) return '0원'
  return `${value > 0 ? '+' : '−'}${formatWon(Math.abs(value))}원`
}

function deltaTone(value: number, goodWhenPositive: boolean) {
  if (value === 0) return 'text-finance-faint'
  return (value > 0) === goodWhenPositive ? 'text-finance-green' : 'text-finance-red'
}

function yoyAmountText({
  delta,
  pct,
}: {
  delta: number
  pct: number | null
}) {
  if (delta === 0) return '–'
  return `${delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(delta))}원${pct === null ? '' : ` (${formatRate(Math.abs(pct))}%)`}`
}

function expenseDeltaPercent(delta: number, previous: number) {
  if (previous <= 0 || delta === 0) return null
  return (delta / previous) * 100
}

export default async function ReportPage({ searchParams }: ReportPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const params = await searchParams
  const rawYear = Array.isArray(params.year) ? params.year[0] : params.year
  const highlightedMajor = Array.isArray(params.major) ? params.major[0] : params.major
  const statsView = parseStatsViewState(params)
  const data = await getReportData(household.householdId, rawYear ? Number(rawYear) : undefined)
  const [dashboard, categoryDetails] = await Promise.all([
    getDashboardData(household.householdId, data.year),
    getCategoryDetails(household.householdId, data.year),
  ])
  const currentMonthKey = currentMonthInKorea()
  const currentMonthIndex = data.year === Number(currentMonthKey.slice(0, 4))
    ? Number(currentMonthKey.slice(5, 7)) - 1
    : null
  const completedMonths = dashboard.monthly.filter((item, index) => item.active && index !== currentMonthIndex).length
  const currentActive = currentMonthIndex !== null && dashboard.monthly[currentMonthIndex]?.active
  const hasAnnualData = data.annual.income + data.annual.expense + data.annual.saving > 0
  const topExpenseMax = data.topExpenses[0]?.amount ?? 1
  const yoyRows = [
    { label: '수입', current: data.annual.income, previous: data.previous.income, delta: data.yoy.income.delta, pct: data.yoy.income.pct, goodWhenPositive: true },
    { label: '지출', current: data.annual.expense, previous: data.previous.expense, delta: data.yoy.expense.delta, pct: data.yoy.expense.pct, goodWhenPositive: false },
    { label: '순저축', current: data.annual.netSaving, previous: data.previous.netSaving, delta: data.yoy.netSaving.delta, pct: data.yoy.netSaving.pct, goodWhenPositive: true },
    { label: '저축 납입', current: data.annual.saving, previous: data.previous.saving, delta: data.yoy.saving.delta, pct: data.yoy.saving.pct, goodWhenPositive: true },
  ]
  function reportYearHref(year: number) {
    const search = new URLSearchParams({ year: String(year) })
    if (highlightedMajor) search.set('major', highlightedMajor)
    return `/report?${statsViewSearch(search.toString(), statsView)}`
  }

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="report" email={household.email} />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-14 pt-10 sm:px-12">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="t-label uppercase text-finance-blue">한 해 통계</p>
            <h1 className="mt-2 t-page-title text-finance-ink">연간 통계</h1>
            <p className="mt-2 t-caption text-finance-muted">
              {data.year}년 · 완료월 {completedMonths}개{currentActive ? ` · ${currentMonthIndex! + 1}월 진행 중` : ''} · 월평균은 완료월 기준
            </p>
          </div>
          <StatsYearSelector highlightedMajor={highlightedMajor} initialView={statsView} nextYear={data.nextYear} previousYear={data.previousYear} year={data.year} />
        </div>

        {!hasAnnualData ? (
          <section className="mt-8 border-y border-finance-ink py-14 text-center">
            <p className="t-label uppercase text-finance-blue">{data.year}년</p>
            <h2 className="mt-3 t-section text-finance-ink">이 연도에는 집계할 거래가 없습니다.</h2>
            <p className="mx-auto mt-2 max-w-md t-body leading-relaxed text-finance-muted">
              다른 연도의 통계를 보거나 거래 파일을 가져오면 연간 성적과 월별 흐름을 확인할 수 있습니다.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link className="border border-finance-ink px-4 py-2 t-caption font-semibold text-finance-ink hover:bg-finance-panel" href={reportYearHref(data.previousYear)}>← {data.previousYear}년 보기</Link>
              <Link className="bg-finance-ink px-4 py-2 t-caption font-semibold text-white hover:bg-finance-blue" href="/inbox">거래 가져오기</Link>
            </div>
          </section>
        ) : (
          <>
        <section className="mt-6 grid divide-y divide-finance-hairline border-y border-finance-ink lg:grid-cols-[400px_repeat(3,minmax(0,1fr))] lg:divide-x lg:divide-y-0">
          <article className="flex items-center gap-5 py-5 pr-6">
            <SavingsProgressRing target={dashboard.savingsTarget} value={data.annual.savingsRate} />
            <div className="min-w-0">
              <p className="t-label text-finance-muted">올해 순저축률</p>
              <p className={`mt-2 t-body-strong ${data.annual.savingsRate >= dashboard.savingsTarget ? 'text-finance-green' : 'text-finance-ink'}`}>
                목표 {formatRate(dashboard.savingsTarget)}% {data.annual.savingsRate >= dashboard.savingsTarget ? '달성' : '진행 중'} · {data.annual.savingsRate - dashboard.savingsTarget >= 0 ? '+' : ''}{formatRate(data.annual.savingsRate - dashboard.savingsTarget)}%p
              </p>
              <p className="mt-2 t-caption leading-relaxed text-finance-muted">
                {data.hasPrevious ? <>전년 {formatRate(data.previous.savingsRate)}% → <strong className={deltaTone(data.savingsRateDelta, true)}>{data.savingsRateDelta >= 0 ? '+' : ''}{formatRate(data.savingsRateDelta)}%p</strong><br /></> : <>전년 데이터 없음<br /></>}
                달성 {dashboard.annual.targetHitMonths}/{dashboard.annual.activeMonths}개월
                {data.bestMonth && ` · 최고 ${data.bestMonth.month}월 ${formatRate(data.bestMonth.savingsRate)}%`}
                {data.worstMonth && ` · 최저 ${data.worstMonth.month}월 ${formatRate(data.worstMonth.savingsRate)}%`}
              </p>
            </div>
          </article>
          {([
            { label: '연 수입', value: data.annual.income, comparison: data.yoy.income, tone: 'text-finance-blue', good: true },
            { label: '연 지출', value: data.annual.expense, comparison: data.yoy.expense, tone: 'text-finance-red', good: false },
            { label: '연 순저축', value: data.annual.netSaving, comparison: data.yoy.netSaving, tone: 'text-finance-green', good: true },
          ] as const).map((item) => (
            <article className="px-0 py-6 lg:px-5" key={item.label}>
              <p className="t-label text-finance-muted">{item.label}</p>
              <p className={`mt-2 t-kpi tabular-nums ${item.tone}`}>{formatWon(item.value)}<span className="ml-1 t-body font-medium text-finance-muted">원</span></p>
              <p className={`mt-2 t-caption ${data.hasPrevious ? deltaTone(item.comparison.delta, item.good) : 'text-finance-faint'}`}>
                {data.hasPrevious ? `전년 대비 ${yoyAmountText(item.comparison)}` : '전년 데이터 없음'}
                {item.label === '연 순저축' && ` · 저축 납입 ${formatWon(data.annual.saving)}원`}
              </p>
            </article>
          ))}
        </section>

        <AnnualFlowOverview annualRate={data.annual.savingsRate} monthly={dashboard.monthly} savingsTarget={dashboard.savingsTarget} />

        <StatsMonthlySection
          accountMonthly={dashboard.accountMonthly}
          details={categoryDetails}
          highlightedMajor={highlightedMajor}
          initialAxis={statsView.axis}
          initialChart={statsView.chart}
          initialFlow={statsView.flow}
          key={`${data.year}:${statsView.chart}:${statsView.flow}:${statsView.axis}:${highlightedMajor ?? ''}`}
          year={data.year}
        />

        <section className="grid gap-8 border-b border-finance-hairline py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-12">
          <div className="min-w-0">
            <h2 className="t-section text-finance-ink">어디에 썼나 <span className="ml-1 font-normal text-finance-muted">올해 지출 대분류 · 비중 · 전년 대비</span></h2>
            {data.topExpenses.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <div className="min-w-[520px] border-t border-finance-ink">
                  <div className="grid grid-cols-[90px_minmax(0,1fr)_110px_58px_90px] items-center gap-x-3 border-b border-finance-hairline py-2 t-label text-finance-muted">
                    <span>대분류</span><span /><span className="text-right">올해</span><span className="text-right">비중</span><span className="text-right">전년 대비</span>
                  </div>
                <ol>
                  {data.topExpenses.map((item) => {
                    const deltaPct = expenseDeltaPercent(item.delta, item.previous)
                    return (
                      <li className="grid grid-cols-[90px_minmax(0,1fr)_110px_58px_90px] items-center gap-x-3 border-b border-finance-track py-2.5 t-caption" key={item.major}>
                        <span className="truncate font-semibold text-finance-ink">{item.major}</span>
                        <span className="h-1.5 bg-finance-track"><span className="block h-full bg-finance-ink" style={{ width: `${(item.amount / topExpenseMax) * 100}%` }} /></span>
                        <span className="text-right font-semibold tabular-nums text-finance-ink">{formatWon(item.amount)}</span>
                        <span className="text-right tabular-nums text-finance-muted">{formatRate(item.percent)}%</span>
                        <span className={`text-right tabular-nums ${deltaPct === null ? 'text-finance-faint' : deltaTone(item.delta, false)}`}>
                          {deltaPct === null ? '–' : `${item.delta > 0 ? '▲' : '▼'} ${formatRate(Math.abs(deltaPct))}%`}
                        </span>
                      </li>
                    )
                  })}
                </ol>
                </div>
              </div>
            ) : <p className="py-10 text-center t-body text-finance-muted">이 연도에는 지출 기록이 없습니다.</p>}
            {data.largestExpense && (
              <p className="mt-4 border-t border-finance-track pt-3 t-caption text-finance-faint">
                최대 단일 지출 · <strong className="text-finance-muted">{formatWon(data.largestExpense.amount)}원</strong> · {data.largestExpense.date} · {data.largestExpense.memo || data.largestExpense.major}
              </p>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="t-section text-finance-ink">가맹점 TOP <span className="ml-1 font-normal text-finance-muted">같은 가맹점 이름을 정규화해 집계</span></h2>
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[520px] border-t border-finance-ink">
              <div className="grid grid-cols-[30px_minmax(0,1fr)_70px_120px_90px] items-center border-b border-finance-hairline py-2 t-label text-finance-muted">
                <span>#</span><span>가맹점</span><span className="text-right">건수</span><span className="text-right">올해</span><span className="text-right">전년 대비</span>
              </div>
              {data.topMerchants.map((merchant, index) => (
                <div className="grid grid-cols-[30px_minmax(0,1fr)_70px_120px_90px] items-center border-b border-finance-track py-2.5 t-caption" key={merchant.name}>
                  <span className="text-finance-faint">{index + 1}</span>
                  <span className="truncate font-medium text-finance-ink">{merchant.name}</span>
                  <span className="text-right text-finance-muted">{merchant.count}건</span>
                  <span className="text-right font-semibold tabular-nums text-finance-ink">{formatWon(merchant.amount)}</span>
                  <span className={`text-right tabular-nums ${merchant.delta === 0 || merchant.previous === 0 ? 'text-finance-faint' : deltaTone(merchant.delta, false)}`}>
                    {merchant.delta === 0 || merchant.previous === 0 ? '–' : `${merchant.delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(merchant.delta))}`}
                  </span>
                </div>
              ))}
              {data.topMerchants.length === 0 && <p className="py-10 text-center t-body text-finance-muted">가맹점 정보가 없습니다.</p>}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-8 py-6 lg:grid-cols-2 lg:gap-12">
          <div className="min-w-0">
            <h2 className="t-section text-finance-ink">전년 같은 기간과 비교 <span className="ml-1 font-normal text-finance-muted">{data.year} vs {data.previousYear}</span></h2>
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[520px] border-t border-finance-ink">
              <div className="grid grid-cols-[minmax(0,1fr)_130px_130px_130px] border-b border-finance-hairline py-2 t-label text-finance-muted">
                <span /><span className="text-right">{data.year}</span><span className="text-right">{data.previousYear}</span><span className="text-right">변화</span>
              </div>
              {yoyRows.map((row) => (
                <div className="grid grid-cols-[minmax(0,1fr)_130px_130px_130px] border-b border-finance-track py-2.5 t-caption" key={row.label}>
                  <span className="font-semibold text-finance-ink">{row.label}</span>
                  <span className="text-right font-semibold tabular-nums text-finance-ink">{formatWon(row.current)}</span>
                  <span className="text-right tabular-nums text-finance-muted">{data.hasPrevious ? formatWon(row.previous) : '–'}</span>
                  <span className={`text-right tabular-nums ${data.hasPrevious ? deltaTone(row.delta, row.goodWhenPositive) : 'text-finance-faint'}`}>{data.hasPrevious && row.pct !== null ? `${row.delta > 0 ? '▲' : row.delta < 0 ? '▼' : '–'} ${formatRate(Math.abs(row.pct))}%` : '–'}</span>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_130px_130px_130px] border-b border-finance-hairline py-2.5 t-caption">
                <span className="font-semibold text-finance-ink">순저축률</span>
                <span className="text-right font-semibold tabular-nums text-finance-green">{formatRate(data.annual.savingsRate)}%</span>
                <span className="text-right tabular-nums text-finance-muted">{data.hasPrevious ? `${formatRate(data.previous.savingsRate)}%` : '–'}</span>
                <span className={`text-right tabular-nums ${data.hasPrevious ? deltaTone(data.savingsRateDelta, true) : 'text-finance-faint'}`}>{data.hasPrevious ? `${data.savingsRateDelta > 0 ? '▲' : data.savingsRateDelta < 0 ? '▼' : '–'} ${formatRate(Math.abs(data.savingsRateDelta))}%p` : '–'}</span>
              </div>
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <h2 className="t-section text-finance-ink">앞으로 6개월 <span className="ml-1 font-normal text-finance-muted">완료월 평균 순흐름 누적 · 추정치</span></h2>
            {data.cashflow.startCash === 0 ? (
              <div className="mt-4 border-y border-finance-hairline py-10 text-center">
                <p className="t-body-strong text-finance-ink">자산을 입력하면 예측이 보입니다.</p>
                <Link className="mt-2 inline-block t-caption font-semibold text-finance-blue" href="/assets">자산 잔고 입력 →</Link>
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 border-y border-finance-hairline divide-x divide-finance-hairline">
                  <div className="py-3 pr-4"><p className="t-label text-finance-muted">현재 현금성 자산</p><p className="mt-1 t-kpi-sm text-finance-ink">{formatWon(data.cashflow.startCash)}<span className="ml-1 t-body text-finance-muted">원</span></p></div>
                  <div className="py-3 pl-4"><p className="t-label text-finance-muted">월평균 순흐름</p><p className={`mt-1 t-kpi-sm ${data.cashflow.monthlyNet >= 0 ? 'text-finance-green' : 'text-finance-red'}`}>{signedWon(data.cashflow.monthlyNet)}</p></div>
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
                  {data.cashflow.forecast.map((row) => (
                    <div className="border-b border-finance-track py-2" key={row.month}>
                      <p className="t-label text-finance-muted">{Number(row.month.slice(5))}월</p>
                      <p className="mt-1 whitespace-nowrap t-caption font-semibold tabular-nums text-finance-ink">{formatWon(row.balance)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
          </>
        )}
      </main>
    </div>
  )
}
