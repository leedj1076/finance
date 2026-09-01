import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { FlowTrendChart } from '@/features/analytics/charts'
import { getAnalysisData } from '@/features/analytics/queries'
import { formatRate, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'
import { createServerSupabase } from '@/lib/supabase/server'

type AnalysisPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const flowLabels = {
  expense: '지출',
  income: '수입',
  saving: '저축',
} as const

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function Summary({ label, value, note, tone = 'neutral' }: {
  label: string
  value: string
  note?: string
  tone?: 'bad' | 'good' | 'neutral'
}) {
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone === 'bad' ? 'text-rose-700' : tone === 'good' ? 'text-emerald-700' : 'text-zinc-950'}`}>{value}</p>
      {note && <p className="mt-2 text-xs text-zinc-500">{note}</p>}
    </article>
  )
}

export default async function AnalysisPage({ searchParams }: AnalysisPageProps) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login')
  const household = await requireHousehold()
  if (!household) redirect('/')

  const params = await searchParams
  const yearParam = firstParam(params.year)
  const accountParam = firstParam(params.account)
  const data = await getAnalysisData(household.householdId, {
    period: firstParam(params.period),
    month: firstParam(params.month),
    year: yearParam ? Number(yearParam) : undefined,
    flow: firstParam(params.flow),
    accountId: accountParam ? Number(accountParam) : undefined,
  })
  const flowLabel = flowLabels[data.flow]
  const basePeriod = data.period === 'month'
    ? `period=month&month=${data.month}`
    : `period=year&year=${data.year}`
  const accountSuffix = data.selectedAccount ? `&account=${data.selectedAccount}` : ''
  const comparisonGood = data.delta !== 0 && (data.flow === 'expense' ? data.delta < 0 : data.delta > 0)
  const maxRank = data.ranks[0]?.amount ?? 1
  const tone = data.flow === 'expense' ? 'rose' : data.flow === 'income' ? 'blue' : 'emerald'

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader active="analysis" email={user.email} />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-emerald-700">거래 패턴</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">분석</h1>
            <p className="mt-2 text-sm text-zinc-500">
              {data.period === 'month' ? data.month : `${data.year}년`} · {flowLabel} 분류별 순위와 변화
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data.period === 'month' ? (
              <>
                <Link aria-label="이전 달" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50" href={`/analysis?period=month&month=${data.previousMonth}&flow=${data.flow}${accountSuffix}`}>←</Link>
                <span className="min-w-24 text-center text-sm font-semibold text-zinc-800">{data.month}</span>
                <Link aria-label="다음 달" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50" href={`/analysis?period=month&month=${data.nextMonth}&flow=${data.flow}${accountSuffix}`}>→</Link>
              </>
            ) : (
              <>
                <Link aria-label="이전 해" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50" href={`/analysis?period=year&year=${data.previousYear}&flow=${data.flow}${accountSuffix}`}>←</Link>
                <span className="min-w-20 text-center text-sm font-semibold text-zinc-800">{data.year}년</span>
                <Link aria-label="다음 해" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50" href={`/analysis?period=year&year=${data.nextYear}&flow=${data.flow}${accountSuffix}`}>→</Link>
              </>
            )}
          </div>
        </div>

        <section className="mt-6 flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <Link className={`rounded-lg px-3 py-2 text-sm font-medium ${data.period === 'month' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`} href={`/analysis?period=month&month=${data.month}&flow=${data.flow}${accountSuffix}`}>월간</Link>
            <Link className={`rounded-lg px-3 py-2 text-sm font-medium ${data.period === 'year' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`} href={`/analysis?period=year&year=${data.year}&flow=${data.flow}${accountSuffix}`}>연간</Link>
            <span className="mx-1 hidden w-px bg-zinc-200 sm:block" />
            {(Object.keys(flowLabels) as Array<keyof typeof flowLabels>).map((flow) => (
              <Link
                className={`rounded-lg px-3 py-2 text-sm font-medium ${data.flow === flow ? 'bg-emerald-700 text-white' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}
                href={`/analysis?${basePeriod}&flow=${flow}${accountSuffix}`}
                key={flow}
              >
                {flowLabels[flow]}
              </Link>
            ))}
          </div>
          <form action="/analysis" className="flex items-center gap-2">
            <input name="period" type="hidden" value={data.period} />
            {data.period === 'month' ? <input name="month" type="hidden" value={data.month} /> : <input name="year" type="hidden" value={data.year} />}
            <input name="flow" type="hidden" value={data.flow} />
            <label className="sr-only" htmlFor="analysis-account">결제수단</label>
            <select className="min-w-48 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700" defaultValue={data.selectedAccount ?? ''} id="analysis-account" name="account">
              <option value="">전체 결제수단</option>
              {data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <button className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50" type="submit">적용</button>
          </form>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Summary label={`총 ${flowLabel}`} value={`${formatWon(data.total)}원`} note={`${data.count.toLocaleString('ko-KR')}건`} />
          <Summary label="건당 평균" value={`${formatWon(data.average)}원`} note="선택 기간의 거래 평균" />
          {data.period === 'month' ? (
            <Summary
              label="전월 대비"
              value={data.delta === 0 ? '변동 없음' : `${data.delta > 0 ? '+' : '−'}${formatWon(Math.abs(data.delta))}원`}
              note={`${data.previousMonth} ${formatWon(data.previousTotal)}원${data.changeRate === null ? '' : ` · ${data.changeRate > 0 ? '+' : ''}${formatRate(data.changeRate)}%`}`}
              tone={data.delta === 0 ? 'neutral' : comparisonGood ? 'good' : 'bad'}
            />
          ) : (
            <Summary label="월평균" value={`${formatWon(Math.round(data.total / Math.max(data.trend.filter((item) => item.active).length, 1)))}원`} note={`${data.trend.filter((item) => item.active).length}개월 기록`} />
          )}
          <Summary label="가장 큰 분류" value={data.ranks[0]?.major ?? '-'} note={data.ranks[0] ? `${formatWon(data.ranks[0].amount)}원 · ${formatRate(data.ranks[0].percent)}%` : '거래 없음'} />
        </section>

        {data.anomalies.length > 0 && (
          <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="font-semibold text-amber-950">평소보다 큰 지출</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {data.anomalies.slice(0, 4).map((alert) => (
                <div className="rounded-xl bg-white/70 px-4 py-3 text-sm text-amber-900" key={alert.major}>
                  <strong>{alert.major}</strong> {formatWon(alert.current)}원 · 평소 약 {formatWon(alert.typical)}원
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="font-semibold text-zinc-950">{data.year}년 월별 {flowLabel}</h2>
            <p className="mt-1 text-xs text-zinc-500">선택한 결제수단 필터가 추이에도 적용됩니다.</p>
          </div>
          <div className="mt-5 overflow-x-auto">
            <FlowTrendChart data={data.trend} label={flowLabel} tone={tone} />
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
          <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div><h2 className="font-semibold text-zinc-950">{flowLabel} 분류 순위</h2><p className="mt-1 text-xs text-zinc-500">전월 대비 증가·감소 포함</p></div>
              <span className="text-sm font-semibold text-zinc-700">{formatWon(data.total)}원</span>
            </div>
            <div className="mt-5 space-y-4">
              {data.ranks.map((rank, index) => {
                const deltaGood = data.flow === 'expense' ? rank.delta < 0 : rank.delta > 0
                return (
                  <div key={rank.major}>
                    <div className="grid grid-cols-[24px_minmax(90px,1fr)_auto] items-center gap-2 text-sm">
                      <span className="text-zinc-400">{index + 1}</span>
                      <div className="min-w-0"><p className="truncate font-medium text-zinc-800">{rank.major}</p><p className="mt-0.5 text-[11px] text-zinc-400">{rank.count}건 · {formatRate(rank.percent)}%</p></div>
                      <div className="text-right"><p className="font-semibold text-zinc-950">{formatWon(rank.amount)}원</p>{data.period === 'month' && <p className={`mt-0.5 text-[11px] ${rank.delta === 0 ? 'text-zinc-400' : deltaGood ? 'text-emerald-600' : 'text-rose-600'}`}>{rank.delta === 0 ? '–' : `${rank.delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(rank.delta))}원`}</p>}</div>
                    </div>
                    <div className="ml-8 mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className={`h-full rounded-full ${data.flow === 'expense' ? 'bg-rose-500' : data.flow === 'income' ? 'bg-blue-500' : 'bg-emerald-500'}`} style={{ width: `${(rank.amount / maxRank) * 100}%` }} /></div>
                  </div>
                )
              })}
              {data.ranks.length === 0 && <p className="py-12 text-center text-sm text-zinc-500">이 기간에는 {flowLabel} 기록이 없습니다.</p>}
            </div>
          </article>

          <article className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-5 py-4"><h2 className="font-semibold text-zinc-950">큰 거래 TOP 10</h2><p className="mt-1 text-xs text-zinc-500">단일 거래 금액 기준</p></div>
            <div className="divide-y divide-zinc-100">
              {data.topTransactions.map((transaction, index) => (
                <div className="flex items-center gap-3 px-5 py-3" key={transaction.id}>
                  <span className="w-5 text-xs text-zinc-400">{index + 1}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-zinc-800">{transaction.merchant || transaction.major}</p><p className="mt-0.5 text-xs text-zinc-400">{transaction.date} · {transaction.major}{transaction.accountName ? ` · ${transaction.accountName}` : ''}</p></div>
                  <span className="shrink-0 text-sm font-semibold text-zinc-950">{formatWon(transaction.amount)}원</span>
                </div>
              ))}
              {data.topTransactions.length === 0 && <p className="px-5 py-12 text-center text-sm text-zinc-500">거래가 없습니다.</p>}
            </div>
          </article>
        </section>

        {data.merchants.length > 0 && (
          <section className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-5 py-4"><h2 className="font-semibold text-zinc-950">가맹점 TOP {data.merchants.length}</h2><p className="mt-1 text-xs text-zinc-500">공백·지점번호를 제거해 같은 가맹점으로 묶었습니다.</p></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500"><tr><th className="px-5 py-3 font-medium">#</th><th className="px-3 py-3 font-medium">가맹점</th><th className="px-3 py-3 text-right font-medium">건수</th><th className="px-3 py-3 text-right font-medium">이번 달</th><th className="px-3 py-3 text-right font-medium">지난달</th><th className="px-5 py-3 text-right font-medium">증감</th></tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.merchants.map((merchant, index) => <tr key={merchant.name}><td className="px-5 py-3 text-zinc-400">{index + 1}</td><td className="px-3 py-3 font-medium text-zinc-800">{merchant.name}</td><td className="px-3 py-3 text-right text-zinc-500">{merchant.count}건</td><td className="px-3 py-3 text-right">{formatWon(merchant.amount)}원</td><td className="px-3 py-3 text-right text-zinc-500">{merchant.previous ? `${formatWon(merchant.previous)}원` : '–'}</td><td className={`px-5 py-3 text-right ${merchant.delta > 0 ? 'text-rose-600' : merchant.delta < 0 ? 'text-emerald-600' : 'text-zinc-400'}`}>{merchant.delta === 0 ? '–' : `${merchant.delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(merchant.delta))}원`}</td></tr>)}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {data.categoryMonthly.length > 0 && (
          <section className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-5 py-4"><h2 className="font-semibold text-zinc-950">항목별 월 추이</h2><p className="mt-1 text-xs text-zinc-500">상위 {data.categoryMonthly.length}개 대분류</p></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] text-right text-xs">
                <thead className="bg-zinc-50 text-zinc-500"><tr><th className="sticky left-0 bg-zinc-50 px-5 py-3 text-left font-medium">분류</th>{Array.from({ length: 12 }, (_, index) => <th className="px-3 py-3 font-medium" key={index}>{index + 1}월</th>)}</tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.categoryMonthly.map((category) => <tr key={category.major}><th className="sticky left-0 bg-white px-5 py-3 text-left text-sm font-medium text-zinc-800">{category.major}</th>{category.values.map((amount, index) => <td className="px-3 py-3 text-zinc-600" key={index}>{amount ? formatWon(amount) : '–'}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {data.period === 'month' && (
          <div className="mt-6 flex justify-end">
            <Link className="text-sm font-medium text-zinc-600 hover:text-zinc-950" href={`/ledger?month=${data.month}`}>{data.month} 거래내역에서 확인 →</Link>
          </div>
        )}
      </main>
    </div>
  )
}
