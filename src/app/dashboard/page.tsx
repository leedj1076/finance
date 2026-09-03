import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import {
  AccountMonthlyPanel,
  CategoryMonthlyPanel,
} from '@/features/analytics/account-monthly-panel'
import { getCategoryDetails } from '@/features/analytics/category-detail'
import { CategoryDetailTable } from '@/features/analytics/category-detail-table'
import { categoryPageUrl } from '@/features/analytics/category-url'
import { MonthlyCashflowChart } from '@/features/analytics/monthly-cashflow-chart'
import { getDashboardData } from '@/features/analytics/queries'
import { formatRate, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function StatCard({ label, value, description, tone = 'neutral' }: {
  label: string
  value: string
  description?: string
  tone?: 'expense' | 'income' | 'neutral' | 'saving'
}) {
  const toneClass = {
    neutral: 'text-finance-ink',
    income: 'text-finance-blue',
    expense: 'text-finance-red',
    saving: 'text-finance-green',
  }[tone]
  return (
    <article className="px-6 py-6 first:pl-0 last:pr-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-muted">{label}</p>
      <p className={`mt-3 text-[26px] font-semibold leading-none tracking-[-0.02em] ${toneClass}`}>{value}</p>
      {description && <p className="mt-2 text-xs text-finance-muted">{description}</p>}
    </article>
  )
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const params = await searchParams
  const rawYear = Array.isArray(params.year) ? params.year[0] : params.year
  const data = await getDashboardData(household.householdId, rawYear ? Number(rawYear) : undefined)
  const categoryDetails = await getCategoryDetails(household.householdId, data.year)
  const expenseDeltaUp = data.current.expenseDelta > 0
  const maxCategory = data.categoryRanks[0]?.amount ?? 1

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="dashboard" email={household.email} />
      <main className="mx-auto max-w-none px-5 pb-12 pt-10 sm:px-12">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">가계 현황</p>
            <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">홈</h1>
            <p className="mt-2 text-xs text-finance-muted">{data.focusMonth} 기준 · {data.year}년 누적</p>
          </div>
          <div className="flex h-[34px] items-center border border-finance-ink">
            <Link aria-label="이전 해" className="grid h-8 w-[34px] place-items-center border-r border-finance-ink text-[13px] hover:bg-finance-track" href={`/dashboard?year=${data.previousYear}`}>←</Link>
            <span className="grid h-8 min-w-[88px] place-items-center px-3 text-[13px] font-semibold">{data.year}년</span>
            <Link aria-label="다음 해" className="grid h-8 w-[34px] place-items-center border-l border-finance-ink text-[13px] hover:bg-finance-track" href={`/dashboard?year=${data.nextYear}`}>→</Link>
          </div>
        </div>

        {(data.pendingInboxCount > 0 || data.budget.paceWarnings.length > 0) && (
          <section className="mt-6 border-t border-finance-ink">
            {data.pendingInboxCount > 0 && (
              <Link className="flex min-h-11 items-center gap-3 border-b border-finance-border py-3 text-[13px] hover:text-finance-blue" href="/inbox">
                <span aria-hidden className="h-[7px] w-[7px] shrink-0 bg-finance-blue" />
                <strong>인박스에 {data.pendingInboxCount}건 대기 중</strong>
                <span className="text-finance-muted">분류를 확인하고 반영하세요</span>
                <span className="ml-auto text-xs font-semibold text-finance-blue">확인 →</span>
              </Link>
            )}
            {data.budget.paceWarnings.length > 0 && (
              <Link className="flex min-h-11 items-center gap-3 border-b border-finance-border py-3 text-[13px] hover:text-finance-blue" href={`/budgets?month=${data.focusMonth}`}>
                <span aria-hidden className="h-[7px] w-[7px] shrink-0 bg-finance-red" />
                <strong>{data.budget.paceWarnings[0].major} 지출 속도가 빠릅니다</strong>
                <span className="text-finance-muted">
                  월말 약 {formatWon(data.budget.paceWarnings[0].projected)}원 · 예산보다 <span className="font-semibold text-finance-red">{formatWon(data.budget.paceWarnings[0].overrun)}원 초과 예상</span>
                  {data.budget.paceWarnings.length > 1 ? ` · 그 외 ${data.budget.paceWarnings.length - 1}개` : ''}
                </span>
                <span className="ml-auto text-xs font-semibold text-finance-blue">예산 보기 →</span>
              </Link>
            )}
          </section>
        )}

        <section className={`${data.pendingInboxCount > 0 || data.budget.paceWarnings.length > 0 ? '' : 'mt-6 border-t border-finance-ink'} grid divide-y divide-finance-border border-b border-finance-ink sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4`}>
          <StatCard label="연 누적 수입" tone="income" value={`${formatWon(data.annual.income)}원`} description={`월평균 ${formatWon(data.annual.averageIncome)}원`} />
          <StatCard label="연 누적 지출" tone="expense" value={`${formatWon(data.annual.expense)}원`} description={`월평균 ${formatWon(data.annual.averageExpense)}원`} />
          <StatCard label="연 순저축" tone="saving" value={`${formatWon(data.annual.netSaving)}원`} description="수입 − 지출" />
          <StatCard
            label="연 순저축률"
            tone={data.annual.savingsRate >= data.savingsTarget ? 'saving' : 'expense'}
            value={`${formatRate(data.annual.savingsRate)}%`}
            description={`목표 ${data.savingsTarget}% · 달성 ${data.annual.targetHitMonths}/${data.annual.activeMonths}개월`}
          />
        </section>

        <section className="border-b border-finance-border py-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-finance-ink">재무 건강</h2>
            <p className="text-[11px] text-finance-faint"><span className="text-finance-green">■</span> 양호 · <span className="text-finance-amber">■</span> 주의 · <span className="text-finance-red">■</span> 경고</p>
          </div>
          <div className="mt-4 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {data.financialHealth.map((item) => {
              const tone = {
                good: 'border-finance-green',
                ok: 'border-finance-amber',
                warn: 'border-finance-red',
                none: 'border-finance-faint',
              }[item.status]
              return (
                <article className={`border-l-2 pl-[14px] ${tone}`} key={item.key}>
                  <p className="text-[11px] font-semibold text-finance-muted">{item.key}</p>
                  <p className="mt-1.5 text-lg font-semibold tracking-tight text-finance-ink">{item.value}</p>
                  <p className="mt-1 text-[11px] text-finance-faint">{item.hint}</p>
                </article>
              )
            })}
          </div>
        </section>

        <section className="grid gap-6 border-b border-finance-border py-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-12">
          <article className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-finance-ink">월별 현금흐름</h2>
              <Link className="text-xs font-semibold text-finance-blue hover:text-finance-ink" href={`/analysis?period=year&year=${data.year}&flow=expense`}>상세 분석 →</Link>
            </div>
            <div className="mt-5 overflow-x-auto">
              <MonthlyCashflowChart data={data.monthly} />
            </div>
          </article>

          <article className="border-t border-finance-border pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
            <h2 className="text-sm font-bold text-finance-ink">{data.focusMonth} 핵심 신호</h2>
            <div className="mt-4">
              {data.insights.map((insight, index) => (
                <div
                  className="flex gap-2.5 border-b border-finance-track py-2.5 text-xs leading-[1.5] text-finance-ink last:border-b-0"
                  key={`${insight.text}-${index}`}
                >
                  <span
                    aria-hidden
                    className={`mt-[5px] h-1.5 w-1.5 shrink-0 ${
                    insight.tone === 'saving'
                      ? 'bg-finance-green'
                      : insight.tone === 'expense'
                        ? 'bg-finance-red'
                        : 'bg-finance-faint'
                    }`}
                  />
                  <span>{insight.text}</span>
                </div>
              ))}
              {data.insights.length === 0 && <p className="py-8 text-center text-xs text-finance-muted">분석할 거래가 없습니다.</p>}
            </div>
          </article>
        </section>

        <section className="grid divide-y divide-finance-border border-b border-finance-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <article className="py-5 pr-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-muted">{data.focusMonth} 수입</p>
            <p className="mt-2 text-xl font-semibold tracking-[-0.02em] text-finance-blue">{formatWon(data.current.income)}원</p>
            <p className="mt-2 text-xs text-finance-muted">저축 납입 {formatWon(data.current.saving)}원</p>
          </article>
          <article className="px-6 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-muted">{data.focusMonth} 지출</p>
            <p className="mt-2 text-xl font-semibold tracking-[-0.02em] text-finance-red">{formatWon(data.current.expense)}원</p>
            <p className={`mt-2 text-xs ${expenseDeltaUp ? 'text-finance-red' : 'text-finance-green'}`}>
              전월 대비 {data.current.expenseDelta === 0 ? '변동 없음' : `${expenseDeltaUp ? '+' : '−'}${formatWon(Math.abs(data.current.expenseDelta))}원`}
            </p>
          </article>
          <article className="py-5 pl-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-muted">{data.focusMonth} 순저축률</p>
            <p className={`mt-2 text-xl font-semibold tracking-[-0.02em] ${data.current.savingsRate >= data.savingsTarget ? 'text-finance-green' : 'text-finance-red'}`}>{formatRate(data.current.savingsRate)}%</p>
            <p className="mt-2 text-xs text-finance-muted">순저축 {formatWon(data.current.netSaving)}원</p>
          </article>
        </section>

        <section className="grid gap-12 border-b border-finance-border py-6 xl:grid-cols-2">
          <article>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-bold text-finance-ink">예산 현황 <span className="text-xs font-normal text-finance-muted">{data.focusMonth}</span></h2>
              <Link className="text-xs font-semibold text-finance-blue hover:text-finance-ink" href={`/budgets?month=${data.focusMonth}`}>예산 수정 →</Link>
            </div>
            <div className="mt-[18px] grid sm:grid-cols-3 sm:divide-x sm:divide-finance-border">
              <div className="pr-4"><p className="text-[11px] text-finance-muted">예산</p><p className="mt-1.5 text-[17px] font-semibold">{formatWon(data.budget.total)}원</p></div>
              <div className="px-4"><p className="text-[11px] text-finance-muted">사용</p><p className="mt-1.5 text-[17px] font-semibold">{formatWon(data.budget.actual)}원</p></div>
              <div className="pl-4"><p className={`text-[11px] ${data.budget.remaining < 0 ? 'text-finance-red' : 'text-finance-green'}`}>{data.budget.remaining < 0 ? '초과' : '남음'}</p><p className={`mt-1.5 text-[17px] font-semibold ${data.budget.remaining < 0 ? 'text-finance-red' : 'text-finance-green'}`}>{formatWon(Math.abs(data.budget.remaining))}원</p></div>
            </div>
            <div className="mt-[18px] h-1.5 bg-finance-track">
              <div className={`h-full ${data.budget.percent !== null && data.budget.percent > 100 ? 'bg-finance-red' : 'bg-finance-blue'}`} style={{ width: `${Math.min(data.budget.percent ?? 0, 100)}%` }} />
            </div>
            <p className="mt-2 text-right text-[11px] text-finance-muted">{data.budget.percent === null ? '예산 미설정' : `${formatRate(data.budget.percent)}% 사용`}</p>
          </article>

          <article>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-bold text-finance-ink">어디서 많이 썼나 <span className="text-xs font-normal text-finance-muted">{data.focusMonth} 지출 대분류</span></h2>
              <Link className="text-xs font-semibold text-finance-blue hover:text-finance-ink" href={`/analysis?period=month&month=${data.focusMonth}&flow=expense`}>전체 보기 →</Link>
            </div>
            <div className="mt-[18px] space-y-3">
              {data.categoryRanks.slice(0, 6).map((rank, index) => (
                <div key={rank.major}>
                  <div className="flex items-center justify-between gap-3 text-xs"><Link className="truncate font-medium text-finance-ink hover:text-finance-blue" href={categoryPageUrl({ flow: 'expense', major: rank.major, period: { month: data.focusMonth } })}>{index + 1}. {rank.major}</Link><span className="shrink-0 font-semibold text-finance-ink">{formatWon(rank.amount)}원</span></div>
                  <div className="mt-[5px] h-[5px] bg-finance-track"><div className="h-full bg-finance-ink" style={{ width: `${(rank.amount / maxCategory) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <AccountMonthlyPanel data={data.accountMonthly} />
        <CategoryMonthlyPanel data={data.categoryMonthly} year={data.year} />

        <div className="mt-6">
          <CategoryDetailTable details={categoryDetails} key={data.year} year={data.year} />
        </div>

        {data.merchantRanks.length > 0 && (
          <section className="mt-6 border-b border-finance-border pb-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-bold text-finance-ink">가맹점 TOP <span className="text-xs font-normal text-finance-muted">같은 가맹점의 지점번호·공백은 합쳐서 계산</span></h2>
              <Link className="text-xs font-semibold text-finance-blue hover:text-finance-ink" href={`/analysis?period=month&month=${data.focusMonth}&flow=expense`}>상세 →</Link>
            </div>
            <div className="mt-4 overflow-x-auto border-t border-finance-ink">
              <table className="w-full min-w-[680px] text-left text-[13px]">
                <thead className="border-b border-finance-border text-[11px] font-semibold uppercase tracking-[0.06em] text-finance-muted"><tr><th className="py-[9px] pr-3 font-semibold">#</th><th className="px-3 py-[9px] font-semibold">가맹점</th><th className="px-3 py-[9px] text-right font-semibold">건수</th><th className="px-3 py-[9px] text-right font-semibold">이번 달</th><th className="py-[9px] pl-3 text-right font-semibold">전월 대비</th></tr></thead>
                <tbody className="divide-y divide-finance-track">
                  {data.merchantRanks.map((merchant, index) => (
                    <tr key={merchant.name}><td className="py-3 pr-3 text-finance-faint">{index + 1}</td><td className="px-3 py-3 font-medium text-finance-ink">{merchant.name}</td><td className="px-3 py-3 text-right text-finance-muted">{merchant.count}건</td><td className="px-3 py-3 text-right font-semibold">{formatWon(merchant.amount)}원</td><td className={`py-3 pl-3 text-right ${merchant.delta > 0 ? 'text-finance-red' : merchant.delta < 0 ? 'text-finance-green' : 'text-finance-faint'}`}>{merchant.delta === 0 ? '–' : `${merchant.delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(merchant.delta))}원`}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
