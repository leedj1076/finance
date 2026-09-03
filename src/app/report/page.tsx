import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import {
  AccountMonthlyPanel,
  CategoryMonthlyPanel,
} from '@/features/analytics/account-monthly-panel'
import { getCategoryDetails } from '@/features/analytics/category-detail'
import { CategoryDetailTable } from '@/features/analytics/category-detail-table'
import { SavingsRateChart } from '@/features/analytics/home-dashboard-charts'
import { MonthlyCashflowChart } from '@/features/analytics/monthly-cashflow-chart'
import { getDashboardData } from '@/features/analytics/queries'
import { getReportData } from '@/features/analytics/report'
import { formatRate, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type ReportPageProps = {
  searchParams: Promise<{
    flow?: string | string[]
    major?: string | string[]
    year?: string | string[]
  }>
}

const KPI_META = [
  { key: 'income', label: '수입', tone: 'income' },
  { key: 'expense', label: '지출', tone: 'expense' },
  { key: 'netSaving', label: '순저축 (수입−지출)', tone: 'saving' },
  { key: 'saving', label: '저축 납입', tone: 'income' },
] as const

const TOP_COLORS = ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#B07AA1']

function signedWon(value: number) {
  if (value === 0) return '+0원'
  return `${value > 0 ? '+' : '−'}${formatWon(Math.abs(value))}원`
}

function SummaryCard({
  label,
  value,
  comparison,
  tone,
  good,
}: {
  label: string
  value: number
  comparison: string
  tone: 'expense' | 'income' | 'saving'
  good: boolean | null
}) {
  const valueColor = tone === 'expense'
    ? 'text-finance-red'
    : tone === 'saving'
      ? 'text-finance-green'
      : 'text-finance-blue'
  return (
    <article className="px-4 py-5 first:pl-0 last:pr-0 sm:px-6">
      <p className="t-label uppercase text-finance-muted">{label}</p>
      <p className={`mt-2 t-kpi tabular-nums ${valueColor}`}>{formatWon(value)}원</p>
      <p className={`mt-2 t-caption ${good === null ? 'text-finance-muted' : good ? 'text-finance-green' : 'text-finance-red'}`}>
        {comparison}
      </p>
    </article>
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

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="report" email={household.email} />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-14 pt-10 sm:px-12">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="t-label uppercase text-finance-blue">한 해 돌아보기</p>
            <h1 className="mt-2 t-page-title text-finance-ink">연간</h1>
            <p className="mt-2 t-caption text-finance-muted">{data.year}년 요약 · 전년 대비 · 현금흐름 예측</p>
          </div>
          <div className="flex items-center gap-2">
            <Link aria-label="이전 해" className="grid h-[34px] w-[34px] place-items-center border border-finance-hairline bg-white text-finance-ink hover:bg-finance-panel" href={`/report?year=${data.previousYear}`}>←</Link>
            <span className="min-w-20 text-center t-body-strong text-finance-ink">{data.year}년</span>
            <Link aria-label="다음 해" className="grid h-[34px] w-[34px] place-items-center border border-finance-hairline bg-white text-finance-ink hover:bg-finance-panel" href={`/report?year=${data.nextYear}`}>→</Link>
          </div>
        </div>

        <section className="mt-6 grid border-y border-finance-ink sm:grid-cols-2 sm:divide-x sm:divide-finance-hairline xl:grid-cols-4">
          {KPI_META.map((meta) => {
            const value = data.annual[meta.key]
            const comparison = data.yoy[meta.key]
            const isGood = comparison.delta === 0
              ? false
              : meta.key === 'expense'
                ? comparison.delta < 0
                : comparison.delta > 0
            const comparisonText = data.hasPrevious
              ? `전년 대비 ${comparison.delta > 0 ? '▲' : comparison.delta < 0 ? '▼' : '–'}${formatWon(Math.abs(comparison.delta))}원${comparison.pct === null ? '' : ` (${formatWon(Math.abs(comparison.pct))}%)`}`
              : '전년 데이터 없음'
            return (
              <SummaryCard
                comparison={comparisonText}
                good={data.hasPrevious ? isGood : null}
                key={meta.key}
                label={meta.label}
                tone={meta.tone}
                value={value}
              />
            )
          })}
        </section>

        <section className="mt-6 border-t border-finance-ink py-4">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="t-section text-finance-ink">연 순저축률</h2>
              <p className="mt-1 t-caption text-finance-muted">순저축률 = (수입 − 지출) / 수입 · 목표 30%</p>
            </div>
            <p className={`t-kpi ${data.annual.savingsRate >= 30 ? 'text-finance-green' : data.annual.savingsRate >= 10 ? 'text-finance-amber' : 'text-finance-red'}`}>
              {formatRate(data.annual.savingsRate)}%
            </p>
          </div>
          <div className="mt-5 grid border-y border-finance-hairline sm:grid-cols-3 sm:divide-x sm:divide-finance-hairline">
            <div className="p-4">
              <p className="t-caption text-finance-muted">전년</p>
              <p className="mt-1 t-body-strong text-finance-ink">
                {data.hasPrevious ? `${formatRate(data.previous.savingsRate)}% · ${data.savingsRateDelta >= 0 ? '+' : ''}${formatRate(data.savingsRateDelta)}%p` : '데이터 없음'}
              </p>
            </div>
            <div className="p-4">
              <p className="t-caption text-finance-green">최고 월</p>
              <p className="mt-1 t-body-strong text-finance-green">{data.bestMonth ? `${data.bestMonth.month}월 · ${formatRate(data.bestMonth.savingsRate)}%` : '수입 기록 없음'}</p>
              <p className="mt-1 t-caption text-finance-muted">목표 달성 {dashboard.annual.targetHitMonths}/{dashboard.annual.activeMonths}개월</p>
            </div>
            <div className="p-4">
              <p className="t-caption text-finance-red">최저 월</p>
              <p className="mt-1 t-body-strong text-finance-red">{data.worstMonth ? `${data.worstMonth.month}월 · ${formatRate(data.worstMonth.savingsRate)}%` : '수입 기록 없음'}</p>
            </div>
          </div>
        </section>

        <section className="mt-6 border-t border-finance-ink py-5">
          <div><h2 className="t-section text-finance-ink">월별 순저축률</h2><p className="mt-1 t-caption text-finance-muted">목표 {formatRate(dashboard.savingsTarget)}% · 달성·미달 월을 같은 기준선에서 비교합니다</p></div>
          <div className="mt-5 overflow-x-auto"><SavingsRateChart data={dashboard.monthly} target={dashboard.savingsTarget} /></div>
        </section>

        <section className="mt-6 border-t border-finance-ink py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="t-section text-finance-ink">월별 수입 · 지출</h2>
              <p className="mt-1 t-caption text-finance-muted">{data.year}년 달력 기준 현금흐름</p>
            </div>
            <p className="t-caption text-finance-muted">연 누적 수입 {formatWon(dashboard.annual.income)}원 · 지출 {formatWon(dashboard.annual.expense)}원 · 순저축 {formatWon(dashboard.annual.netSaving)}원</p>
          </div>
          <div className="mt-5 overflow-x-auto">
            <MonthlyCashflowChart data={dashboard.monthly} />
          </div>
        </section>

        <section className="mt-6" id="category-detail">
          <CategoryDetailTable
            details={categoryDetails}
            highlightedMajor={highlightedMajor}
            initialFlow={initialFlow}
            key={`${data.year}:${initialFlow}:${highlightedMajor ?? ''}`}
            year={data.year}
          />
        </section>

        <AccountMonthlyPanel data={dashboard.accountMonthly} />
        <CategoryMonthlyPanel data={dashboard.categoryMonthly} year={dashboard.year} />

        <section className="mt-6 overflow-hidden border-t border-finance-ink">
          <div className="border-b border-finance-hairline py-4">
            <h2 className="t-section text-finance-ink">지출 TOP {data.topExpenses.length}</h2>
            <p className="mt-1 t-caption text-finance-muted">{data.year}년 전체 지출 대비 비중</p>
          </div>
          <div className="py-5">
            {data.topExpenses.length > 0 ? (
              <div className="overflow-x-auto">
                <ol className="min-w-[620px] space-y-4">
                  {data.topExpenses.map((item, index) => (
                    <li className="grid grid-cols-[24px_12px_minmax(90px,0.6fr)_minmax(100px,1fr)_auto_auto] items-center gap-3 t-body" key={item.major}>
                      <span className="text-finance-faint">{index + 1}</span>
                      <span aria-hidden className="h-2.5 w-2.5" style={{ backgroundColor: TOP_COLORS[index] }} />
                      <span className="truncate font-medium text-finance-ink">{item.major}</span>
                      <span className="h-[5px] overflow-hidden bg-finance-track">
                        <span className="block h-full" style={{ backgroundColor: TOP_COLORS[index], width: `${item.percent}%` }} />
                      </span>
                      <span className="whitespace-nowrap text-right font-semibold text-finance-ink">{formatWon(item.amount)}원</span>
                      <span className="w-14 text-right t-caption text-finance-muted">{formatRate(item.percent)}%</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="py-10 text-center t-body text-finance-muted">이 연도에는 지출 기록이 없습니다.</p>
            )}
            {data.largestExpense && (
              <p className="mt-5 border-t border-finance-border pt-4 t-caption text-finance-muted">
                최대 단일 지출 · <strong className="text-finance-ink">{formatWon(data.largestExpense.amount)}원</strong>
                {' · '}{data.largestExpense.memo || data.largestExpense.major} ({data.largestExpense.date})
              </p>
            )}
          </div>
        </section>

        <section className="mt-6 overflow-hidden border-t border-finance-ink">
          <div className="border-b border-finance-hairline py-4"><h2 className="t-section text-finance-ink">가맹점 TOP {data.topMerchants.length}</h2><p className="mt-1 t-caption text-finance-muted">{data.year}년 전체 지출 · 같은 가맹점 이름을 정규화해 집계</p></div>
          <ol className="divide-y divide-finance-hairline">
            {data.topMerchants.map((merchant, index) => (
              <li className="grid grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-3 py-3 t-body" key={merchant.name}>
                <span className="text-finance-faint">{index + 1}</span>
                <span className="truncate font-medium text-finance-ink">{merchant.name}</span>
                <span className="t-caption text-finance-muted">{merchant.count}건</span>
                <span className="font-semibold tabular-nums text-finance-ink">{formatWon(merchant.amount)}원</span>
              </li>
            ))}
            {data.topMerchants.length === 0 && <li className="py-10 text-center t-body text-finance-muted">가맹점 정보가 없습니다.</li>}
          </ol>
        </section>

        <section className="mt-6 overflow-hidden border-t border-finance-ink">
          <div className="flex flex-col gap-2 border-b border-finance-hairline py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="t-section text-finance-ink">6개월 현금흐름 예측</h2>
              <p className="mt-1 t-caption text-finance-muted">완료월 {data.cashflow.completedMonthDivisor}개월의 월평균 순흐름을 현재 잔액에 누적</p>
            </div>
            <span className="t-caption text-finance-muted">추정치</span>
          </div>
          <div className="py-5">
            <div className="grid border-y border-finance-hairline sm:grid-cols-2 sm:divide-x sm:divide-finance-hairline">
              <div className="p-4">
                <p className="t-caption text-finance-muted">현재 현금성 자산</p>
                <p className="mt-1 t-kpi-sm text-finance-ink">{formatWon(data.cashflow.startCash)}원</p>
                {data.cashflow.startCash === 0 && <p className="mt-1 t-caption text-finance-faint">자산 페이지에 잔고를 입력하면 실제 잔액으로 예측합니다.</p>}
              </div>
              <div className="p-4">
                <p className={`t-caption ${data.cashflow.monthlyNet >= 0 ? 'text-finance-green' : 'text-finance-red'}`}>월평균 순흐름</p>
                <p className={`mt-1 t-kpi-sm ${data.cashflow.monthlyNet >= 0 ? 'text-finance-green' : 'text-finance-red'}`}>{signedWon(data.cashflow.monthlyNet)}</p>
              </div>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left t-body">
                <caption className="sr-only">향후 6개월 월별 순흐름 및 예상 잔액</caption>
                <thead className="border-b border-finance-hairline bg-finance-panel t-label uppercase text-finance-muted">
                  <tr><th className="px-4 py-3 font-medium" scope="col">월</th><th className="px-4 py-3 text-right font-medium" scope="col">순흐름</th><th className="px-4 py-3 text-right font-medium" scope="col">예상 잔액</th></tr>
                </thead>
                <tbody className="divide-y divide-finance-hairline">
                  {data.cashflow.forecast.map((row) => (
                    <tr key={row.month}>
                      <th className="px-4 py-3 font-medium text-finance-ink" scope="row">{row.month}</th>
                      <td className={`px-4 py-3 text-right tabular-nums ${row.net >= 0 ? 'text-finance-green' : 'text-finance-red'}`}>{signedWon(row.net)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-finance-ink">{formatWon(row.balance)}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
