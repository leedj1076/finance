import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { getCategoryDetails } from '@/features/analytics/category-detail'
import { SavingsProgressRing } from '@/features/analytics/home-dashboard-charts'
import { getDashboardData } from '@/features/analytics/queries'
import { getReportData } from '@/features/analytics/report'
import { StatsMonthlySection } from '@/features/analytics/stats-monthly-section'
import { currentMonthInKorea, formatRate, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type ReportPageProps = {
  searchParams: Promise<{
    flow?: string | string[]
    major?: string | string[]
    year?: string | string[]
  }>
}

type MonthlyFlowRow = {
  month: string
  income: number
  expense: number
  saving: number
  savingsRate: number
  active: boolean
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

function AnnualFlowOverview({
  monthly,
  annualRate,
  savingsTarget,
}: {
  monthly: MonthlyFlowRow[]
  annualRate: number
  savingsTarget: number
}) {
  const maxValue = Math.max(1, ...monthly.flatMap((item) => item.active ? [item.income, item.expense, item.saving] : []))
  const currentMonthKey = currentMonthInKorea()
  const gridColumns = '150px repeat(12, minmax(0, 1fr)) 110px 95px 90px'
  const targetTop = Math.max(0, Math.min(37, ((50 - savingsTarget) / 50) * 40))

  return (
    <section className="border-b border-finance-hairline py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h2 className="t-section text-finance-ink">수입 · 지출 · 저축</h2>
          <p className="mt-1 t-caption text-finance-faint">월별 수입·지출·저축 납입과 순저축률 · 아래 표와 같은 12개 열</p>
        </div>
        <div className="flex flex-wrap gap-4 t-caption text-finance-muted">
          <span><i className="mr-1.5 inline-block h-[9px] w-[9px] bg-finance-blue" />수입</span>
          <span><i className="mr-1.5 inline-block h-[9px] w-[9px] bg-finance-ink" />지출</span>
          <span><i className="mr-1.5 inline-block h-[9px] w-[9px] bg-finance-green" />저축 납입</span>
          <span><i className="mr-1.5 inline-block h-[7px] w-[7px] border-2 border-finance-green" />순저축률</span>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[1200px]">
          <div className="grid h-[120px] items-end gap-x-1.5" style={{ gridTemplateColumns: gridColumns }}>
            <div className="relative h-full t-axis text-finance-faint">
              <span className="absolute right-2 top-0">{Math.round(maxValue / 10_000)}만</span>
              <span className="absolute right-2 top-[52px]">{Math.round(maxValue / 20_000)}만</span>
              <span className="absolute bottom-0 right-2">0</span>
            </div>
            {monthly.map((item) => {
              const inProgress = item.month === currentMonthKey
              return (
                <div className={`relative flex h-[120px] items-end justify-center gap-0.5 border-t border-finance-track ${inProgress ? 'opacity-60' : ''}`} key={item.month}>
                  <span className="absolute inset-x-0 top-[60px] border-t border-finance-track" />
                  {item.active && (
                    <>
                      <span className="relative w-3 bg-finance-blue" style={{ height: `${Math.round((item.income / maxValue) * 118)}px` }} />
                      <span className="relative w-3 bg-finance-ink" style={{ height: `${Math.round((item.expense / maxValue) * 118)}px` }} />
                      <span className="relative w-3 bg-finance-green" style={{ height: `${Math.round((item.saving / maxValue) * 118)}px` }} />
                    </>
                  )}
                </div>
              )
            })}
            <div className="self-end text-right t-caption text-finance-muted">연 합계</div>
            <div />
            <div />
          </div>
          <div className="mt-2 grid h-11 items-center gap-x-1.5" style={{ gridTemplateColumns: gridColumns }}>
            <div className="t-caption text-finance-muted">순저축률 <span className="text-finance-faint">· 목표 {formatRate(savingsTarget)}%</span></div>
            <div className="relative col-span-12 h-11">
              <span className="absolute inset-x-0 border-t-[1.5px] border-dashed border-finance-green" style={{ top: `${targetTop}px` }} />
              <div className="absolute inset-0 grid grid-cols-12">
                {monthly.map((item) => {
                  const dotTop = Math.max(0, Math.min(37, ((50 - item.savingsRate) / 50) * 40))
                  return (
                    <div className="relative" key={item.month}>
                      {item.active && (
                        <>
                          <span className={`absolute left-1/2 h-[7px] w-[7px] -translate-x-1/2 ${item.savingsRate >= savingsTarget ? 'bg-finance-green' : 'bg-finance-ink'} ${item.month === currentMonthKey ? 'opacity-60' : ''}`} style={{ top: `${dotTop}px` }} />
                          <span className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap t-axis ${item.savingsRate < 20 ? 'text-finance-red' : 'text-finance-muted'}`} style={{ top: `${dotTop + 10}px` }}>{formatRate(item.savingsRate)}</span>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className={`text-right t-body-strong ${annualRate >= savingsTarget ? 'text-finance-green' : 'text-finance-ink'}`}>{formatRate(annualRate)}%</div>
            <div className="text-right t-caption text-finance-muted">연 저축률</div>
            <div />
          </div>
        </div>
      </div>
    </section>
  )
}

export default async function ReportPage({ searchParams }: ReportPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const params = await searchParams
  const rawYear = Array.isArray(params.year) ? params.year[0] : params.year
  const highlightedMajor = Array.isArray(params.major) ? params.major[0] : params.major
  const rawFlow = Array.isArray(params.flow) ? params.flow[0] : params.flow
  const initialFlow = rawFlow === 'income' || rawFlow === 'saving' ? rawFlow : 'expense'
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
  const topExpenseMax = data.topExpenses[0]?.amount ?? 1
  const yoyRows = [
    { label: '수입', current: data.annual.income, previous: data.previous.income, delta: data.yoy.income.delta, pct: data.yoy.income.pct, goodWhenPositive: true },
    { label: '지출', current: data.annual.expense, previous: data.previous.expense, delta: data.yoy.expense.delta, pct: data.yoy.expense.pct, goodWhenPositive: false },
    { label: '순저축', current: data.annual.netSaving, previous: data.previous.netSaving, delta: data.yoy.netSaving.delta, pct: data.yoy.netSaving.pct, goodWhenPositive: true },
    { label: '저축 납입', current: data.annual.saving, previous: data.previous.saving, delta: data.yoy.saving.delta, pct: data.yoy.saving.pct, goodWhenPositive: true },
  ]

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
          <div className="flex items-center border border-finance-ink">
            <Link aria-label="이전 해" className="grid h-8 w-[34px] place-items-center border-r border-finance-ink text-finance-ink hover:bg-finance-panel" href={`/report?year=${data.previousYear}`}>←</Link>
            <span className="grid h-8 w-[88px] place-items-center t-body-strong text-finance-ink">{data.year}년</span>
            <Link aria-label="다음 해" className="grid h-8 w-[34px] place-items-center border-l border-finance-ink text-finance-ink hover:bg-finance-panel" href={`/report?year=${data.nextYear}`}>→</Link>
          </div>
        </div>

        <section className="mt-6 grid border-y border-finance-ink lg:grid-cols-[400px_repeat(3,minmax(0,1fr))] lg:divide-x lg:divide-finance-hairline">
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
            <article className="px-5 py-6 first:border-t first:border-finance-hairline lg:first:border-t-0" key={item.label}>
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
          categoryMonthly={dashboard.categoryMonthly}
          details={categoryDetails}
          highlightedMajor={highlightedMajor}
          initialFlow={initialFlow}
          key={`${data.year}:${initialFlow}:${highlightedMajor ?? ''}`}
          year={data.year}
        />

        <section className="grid gap-8 border-b border-finance-hairline py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-12">
          <div>
            <h2 className="t-section text-finance-ink">어디에 썼나 <span className="ml-1 font-normal text-finance-muted">올해 지출 대분류 · 비중</span></h2>
            {data.topExpenses.length > 0 ? (
              <ol className="mt-4 space-y-2.5">
                {data.topExpenses.map((item) => (
                  <li className="grid grid-cols-[90px_minmax(0,1fr)_100px_56px_90px] items-center gap-x-3 t-caption" key={item.major}>
                    <span className="truncate font-semibold text-finance-ink">{item.major}</span>
                    <span className="h-1.5 bg-finance-track"><span className="block h-full bg-finance-ink" style={{ width: `${(item.amount / topExpenseMax) * 100}%` }} /></span>
                    <span className="text-right font-semibold tabular-nums text-finance-ink">{formatWon(item.amount)}</span>
                    <span className="text-right tabular-nums text-finance-muted">{formatRate(item.percent)}%</span>
                    <span className="text-right text-finance-faint">전년 –</span>
                  </li>
                ))}
              </ol>
            ) : <p className="py-10 text-center t-body text-finance-muted">이 연도에는 지출 기록이 없습니다.</p>}
            {data.largestExpense && (
              <p className="mt-4 border-t border-finance-track pt-3 t-caption text-finance-faint">
                최대 단일 지출 · <strong className="text-finance-muted">{formatWon(data.largestExpense.amount)}원</strong> · {data.largestExpense.date} · {data.largestExpense.memo || data.largestExpense.major}
              </p>
            )}
          </div>
          <div>
            <h2 className="t-section text-finance-ink">가맹점 TOP <span className="ml-1 font-normal text-finance-muted">같은 가맹점 이름을 정규화해 집계</span></h2>
            <div className="mt-4 border-t border-finance-ink">
              <div className="grid grid-cols-[30px_minmax(0,1fr)_70px_120px_90px] border-b border-finance-hairline py-2 t-label text-finance-muted">
                <span>#</span><span>가맹점</span><span className="text-right">건수</span><span className="text-right">올해</span><span className="text-right">전년 대비</span>
              </div>
              {data.topMerchants.map((merchant, index) => (
                <div className="grid grid-cols-[30px_minmax(0,1fr)_70px_120px_90px] border-b border-finance-track py-2.5 t-caption" key={merchant.name}>
                  <span className="text-finance-faint">{index + 1}</span>
                  <span className="truncate font-medium text-finance-ink">{merchant.name}</span>
                  <span className="text-right text-finance-muted">{merchant.count}건</span>
                  <span className="text-right font-semibold tabular-nums text-finance-ink">{formatWon(merchant.amount)}</span>
                  <span className="text-right text-finance-faint">–</span>
                </div>
              ))}
              {data.topMerchants.length === 0 && <p className="py-10 text-center t-body text-finance-muted">가맹점 정보가 없습니다.</p>}
            </div>
          </div>
        </section>

        <section className="grid gap-8 py-6 lg:grid-cols-2 lg:gap-12">
          <div>
            <h2 className="t-section text-finance-ink">전년 같은 기간과 비교 <span className="ml-1 font-normal text-finance-muted">{data.year} vs {data.previousYear}</span></h2>
            <div className="mt-4 border-t border-finance-ink">
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
          <div>
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
      </main>
    </div>
  )
}
