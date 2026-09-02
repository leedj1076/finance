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
import { MonthlyCashflowChart } from '@/features/analytics/charts'
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
    <div className="min-h-screen bg-zinc-50">
      <AppHeader active="dashboard" email={household.email} />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-emerald-700">가계 현황</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">대시보드</h1>
            <p className="mt-2 text-sm text-zinc-500">{data.focusMonth} 기준 · {data.year}년 누적</p>
          </div>
          <div className="flex items-center gap-2">
            <Link aria-label="이전 해" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50" href={`/dashboard?year=${data.previousYear}`}>←</Link>
            <span className="min-w-20 text-center text-sm font-semibold text-zinc-800">{data.year}년</span>
            <Link aria-label="다음 해" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50" href={`/dashboard?year=${data.nextYear}`}>→</Link>
          </div>
        </div>

        {data.pendingInboxCount > 0 && (
          <Link className="mt-5 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100" href="/inbox">
            <span><strong>인박스에 {data.pendingInboxCount}건 대기 중</strong> · 분류를 확인하고 반영하세요.</span>
            <span aria-hidden>→</span>
          </Link>
        )}

        {data.budget.paceWarnings.length > 0 && (
          <Link className="mt-5 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 hover:bg-rose-100" href={`/budgets?month=${data.focusMonth}`}>
            <span>
              <strong>{data.budget.paceWarnings[0].major} 지출 속도가 빠릅니다</strong>
              {' · '}월말 약 {formatWon(data.budget.paceWarnings[0].projected)}원, 예산보다 {formatWon(data.budget.paceWarnings[0].overrun)}원 초과 예상
              {data.budget.paceWarnings.length > 1 ? ` · 그 외 ${data.budget.paceWarnings.length - 1}개` : ''}
            </span>
            <span aria-hidden>→</span>
          </Link>
        )}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-zinc-950">재무 건강</h2>
            <p className="text-xs text-zinc-500">초록=양호 · 노랑=주의 · 빨강=경고</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.financialHealth.map((item) => {
              const tone = {
                good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
                ok: 'border-amber-200 bg-amber-50 text-amber-900',
                warn: 'border-rose-200 bg-rose-50 text-rose-900',
                none: 'border-zinc-200 bg-zinc-50 text-zinc-700',
              }[item.status]
              return (
                <article className={`rounded-xl border p-4 ${tone}`} key={item.key}>
                  <p className="text-xs font-medium opacity-75">{item.key}</p>
                  <p className="mt-2 text-xl font-semibold tracking-tight">{item.value}</p>
                  <p className="mt-2 text-xs leading-5 opacity-75">{item.hint}</p>
                </article>
              )
            })}
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
          <article className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-zinc-950">월별 현금흐름</h2>
                <p className="mt-1 text-xs text-zinc-500">점에 마우스를 올리면 금액과 순저축률을 볼 수 있습니다.</p>
              </div>
              <Link className="text-sm font-medium text-emerald-700 hover:text-emerald-900" href={`/analysis?period=year&year=${data.year}&flow=expense`}>상세 분석 →</Link>
            </div>
            <div className="mt-5 overflow-x-auto">
              <MonthlyCashflowChart data={data.monthly} />
            </div>
          </article>

          <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-zinc-950">{data.focusMonth} 핵심 신호</h2>
            <div className="mt-4 space-y-3">
              {data.insights.map((insight, index) => (
                <div
                  className={`rounded-xl px-3 py-3 text-sm leading-5 ${
                    insight.tone === 'saving'
                      ? 'bg-emerald-50 text-emerald-800'
                      : insight.tone === 'expense'
                        ? 'bg-rose-50 text-rose-800'
                        : 'bg-zinc-100 text-zinc-700'
                  }`}
                  key={`${insight.text}-${index}`}
                >
                  {insight.text}
                </div>
              ))}
              {data.insights.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">분석할 거래가 없습니다.</p>}
            </div>
          </article>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-3">
          <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-zinc-500">{data.focusMonth} 수입</p>
            <p className="mt-2 text-2xl font-semibold text-blue-700">{formatWon(data.current.income)}원</p>
            <p className="mt-2 text-xs text-zinc-500">저축 납입 {formatWon(data.current.saving)}원</p>
          </article>
          <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-zinc-500">{data.focusMonth} 지출</p>
            <p className="mt-2 text-2xl font-semibold text-rose-700">{formatWon(data.current.expense)}원</p>
            <p className={`mt-2 text-xs ${expenseDeltaUp ? 'text-rose-600' : 'text-emerald-600'}`}>
              전월 대비 {data.current.expenseDelta === 0 ? '변동 없음' : `${expenseDeltaUp ? '+' : '−'}${formatWon(Math.abs(data.current.expenseDelta))}원`}
            </p>
          </article>
          <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-zinc-500">{data.focusMonth} 순저축률</p>
            <p className={`mt-2 text-2xl font-semibold ${data.current.savingsRate >= data.savingsTarget ? 'text-emerald-700' : 'text-rose-700'}`}>{formatRate(data.current.savingsRate)}%</p>
            <p className="mt-2 text-xs text-zinc-500">순저축 {formatWon(data.current.netSaving)}원</p>
          </article>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-2">
          <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-zinc-950">예산 현황</h2>
                <p className="mt-1 text-xs text-zinc-500">{data.focusMonth} 대분류 예산</p>
              </div>
              <Link className="text-sm font-medium text-emerald-700 hover:text-emerald-900" href={`/budgets?month=${data.focusMonth}`}>예산 수정 →</Link>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-zinc-50 p-3"><p className="text-xs text-zinc-500">예산</p><p className="mt-1 font-semibold">{formatWon(data.budget.total)}원</p></div>
              <div className="rounded-xl bg-zinc-50 p-3"><p className="text-xs text-zinc-500">사용</p><p className="mt-1 font-semibold">{formatWon(data.budget.actual)}원</p></div>
              <div className={`rounded-xl p-3 ${data.budget.remaining < 0 ? 'bg-rose-50' : 'bg-emerald-50'}`}><p className={`text-xs ${data.budget.remaining < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{data.budget.remaining < 0 ? '초과' : '남음'}</p><p className="mt-1 font-semibold">{formatWon(Math.abs(data.budget.remaining))}원</p></div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100">
              <div className={`h-full rounded-full ${data.budget.percent !== null && data.budget.percent > 100 ? 'bg-rose-600' : 'bg-emerald-600'}`} style={{ width: `${Math.min(data.budget.percent ?? 0, 100)}%` }} />
            </div>
            <p className="mt-2 text-right text-xs text-zinc-500">{data.budget.percent === null ? '예산 미설정' : `${formatRate(data.budget.percent)}% 사용`}</p>
          </article>

          <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-zinc-950">어디서 많이 썼나</h2>
                <p className="mt-1 text-xs text-zinc-500">{data.focusMonth} 지출 대분류</p>
              </div>
              <Link className="text-sm font-medium text-emerald-700 hover:text-emerald-900" href={`/analysis?period=month&month=${data.focusMonth}&flow=expense`}>전체 보기 →</Link>
            </div>
            <div className="mt-5 space-y-4">
              {data.categoryRanks.slice(0, 6).map((rank, index) => (
                <div key={rank.major}>
                  <div className="flex items-center justify-between gap-3 text-sm"><Link className="truncate text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-emerald-700" href={categoryPageUrl({ flow: 'expense', major: rank.major, period: { month: data.focusMonth } })}>{index + 1}. {rank.major}</Link><span className="shrink-0 font-medium text-zinc-950">{formatWon(rank.amount)}원</span></div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${(rank.amount / maxCategory) * 100}%` }} /></div>
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
          <section className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div><h2 className="font-semibold text-zinc-950">가맹점 TOP</h2><p className="mt-1 text-xs text-zinc-500">같은 가맹점의 지점번호·공백은 합쳐서 계산</p></div>
              <Link className="text-sm font-medium text-emerald-700 hover:text-emerald-900" href={`/analysis?period=month&month=${data.focusMonth}&flow=expense`}>상세 →</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500"><tr><th className="px-5 py-3 font-medium">#</th><th className="px-3 py-3 font-medium">가맹점</th><th className="px-3 py-3 text-right font-medium">건수</th><th className="px-3 py-3 text-right font-medium">이번 달</th><th className="px-5 py-3 text-right font-medium">전월 대비</th></tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.merchantRanks.map((merchant, index) => (
                    <tr key={merchant.name}><td className="px-5 py-3 text-zinc-400">{index + 1}</td><td className="px-3 py-3 text-zinc-800">{merchant.name}</td><td className="px-3 py-3 text-right text-zinc-500">{merchant.count}건</td><td className="px-3 py-3 text-right font-medium">{formatWon(merchant.amount)}원</td><td className={`px-5 py-3 text-right ${merchant.delta > 0 ? 'text-rose-600' : merchant.delta < 0 ? 'text-emerald-600' : 'text-zinc-400'}`}>{merchant.delta === 0 ? '–' : `${merchant.delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(merchant.delta))}원`}</td></tr>
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
