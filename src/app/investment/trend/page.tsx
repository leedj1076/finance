import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AllocationBars } from '@/features/investment/allocation-bars'
import { formatMoney, formatPct, formatSigned } from '@/features/investment/format'
import { KpiBand } from '@/features/investment/kpi-band'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getHoldingsData, getTrendData, loadPortfolioInputs } from '@/features/investment/queries'
import { TrendChart } from '@/features/investment/trend-chart'
import { requireHousehold } from '@/lib/household'

type Range = '1m' | '3m' | '1y' | 'all'
type Scope = 'total' | 'KR' | 'US'
type Props = { searchParams: Promise<{ range?: string | string[]; scope?: string | string[] }> }

const RANGES: Array<[Range, string]> = [['1m', '1개월'], ['3m', '3개월'], ['1y', '1년'], ['all', '전체']]
const SCOPES: Array<[Scope, string]> = [['total', '합계'], ['KR', '국내'], ['US', '해외 $']]
const href = (range: Range, scope: Scope) => `/investment/trend?range=${range}&scope=${scope}`

export default async function InvestmentTrendPage({ searchParams }: Props) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const params = await searchParams
  const range = (RANGES.find(([key]) => key === params.range)?.[0] ?? '3m') as Range
  const scope = (SCOPES.find(([key]) => key === params.scope)?.[0] ?? 'total') as Scope
  const [trend, holdings, inputs] = await Promise.all([getTrendData(household.householdId, range, scope), getHoldingsData(household.householdId), loadPortfolioInputs(household.householdId)])
  const first = trend.points[0]; const last = trend.points[trend.points.length - 1]
  const delta = first && last ? last.value - first.value : null
  const currency = scope === 'US' ? 'USD' : 'KRW'
  const rows = holdings.groups.flatMap(group => group.markets.flatMap(m => m.rows))
  const priced = (market: 'KR' | 'US') => rows.filter(row => row.market === market).every(row => row.marketValue !== null)
  const profitKnown = (market: 'KR' | 'US') => rows.filter(row => row.market === market).every(row => row.unrealized !== null)
  const allocationKnown = rows.filter(row => row.currency === 'KRW' || inputs.fx).every(row => row.marketValue !== null)
  const segment = (items: Array<[string, string]>, active: string, make: (key: string) => string) => (
    <div className="flex border border-finance-border" role="group">
      {items.map(([key, text]) => <Link aria-current={active === key ? 'true' : undefined} className={`flex h-[34px] items-center border-r border-finance-border px-2.5 t-caption-strong last:border-r-0 ${active === key ? 'bg-finance-track text-finance-ink' : 'text-finance-muted'}`} href={make(key)} key={key}>{text}</Link>)}
    </div>
  )
  return (
    <InvestmentPageShell active="investment-trend" email={household.email} eyebrow="Trend" title="추이" subtitle="평가금액 · 투입원금 · 비중"
      status={holdings.status} owners={[]} owner={null} ownerHref={() => '/investment/trend'}>
      <KpiBand items={[
        { label: `${RANGES.find(([k]) => k === range)![1]} 변동 (${scope === 'US' ? '달러' : '원화'})`, value: delta === null ? '–' : formatSigned(delta, currency), tone: delta === null ? 'ink' : delta >= 0 ? 'blue' : 'red', caption: trend.empty ? '일별 스냅샷은 키움 연동 후 쌓입니다' : `${first.date} → ${last.date}` },
        { label: '국내 평가', value: priced('KR') ? <>{formatMoney(holdings.summary.KR.value, 'KRW')}<span className="ml-1 t-body font-medium text-finance-muted">원</span></> : '–', caption: !priced('KR') ? '시세 없음' : !profitKnown('KR') ? '단가 없음' : <>손익 {formatSigned(holdings.summary.KR.unrealized, 'KRW')} · {formatPct(holdings.summary.KR.returnPct)}</> },
        { label: '해외 평가', value: priced('US') ? formatMoney(holdings.summary.US.value, 'USD') : '–', caption: !priced('US') ? '시세 없음' : !profitKnown('US') ? '단가 없음' : <>손익 {formatSigned(holdings.summary.US.unrealized, 'USD')} · {formatPct(holdings.summary.US.returnPct)}</> },
        { label: '연환산 수익률', value: '–', caption: '스냅샷 1년 이상 쌓이면 계산' },
      ]} />
      <section className="grid gap-10 py-7 xl:grid-cols-[1.2fr_1fr] xl:gap-x-0">
        <article className="min-w-0 xl:pr-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="t-section text-finance-ink">평가금액 추이</h2><p className="mt-1 t-caption text-finance-faint">일별 종가 스냅샷 · {scope === 'total' ? '원화 환산 합계' : scope === 'KR' ? '국내 · 원' : '해외 · 달러'}</p></div>
            <div className="flex flex-wrap gap-2">{segment(SCOPES, scope, (key) => href(range, key as Scope))}{segment(RANGES, range, (key) => href(key as Range, scope))}</div>
          </div>
          {trend.empty
            ? <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">아직 일별 스냅샷이 없습니다. 키움 연동(2단계)이 켜지면 장 마감마다 쌓이고 빠진 날은 백필됩니다.</p>
            : <div className="mt-5 min-w-0"><TrendChart points={trend.points} scope={scope} /><p className="mt-3 flex gap-4 t-caption text-finance-muted"><span><i className="mr-1.5 inline-block h-[2px] w-3.5 bg-[var(--chart-1)] align-middle" />평가금액</span><span><i className="mr-1.5 inline-block h-[2px] w-3.5 bg-[var(--chart-2)] align-middle" />투입원금</span></p></div>}
        </article>
        <article className="min-w-0 xl:border-l xl:border-finance-border xl:pl-10">
          <div><h2 className="t-section text-finance-ink">비중</h2><p className="mt-1 t-caption text-finance-faint">평가금액 기준 · 원화 환산 · 시장</p></div>
          {inputs.fx === null && <p className="mt-2 t-caption text-finance-amber">환율 없음 · 해외 미포함</p>}
          {allocationKnown ? <AllocationBars items={trend.allocation.filter(item => inputs.fx || !['해외 주식', '달러 예수금'].includes(item.label))} /> : <p className="mt-4 t-body text-finance-muted">시세 없음 · 비중을 계산할 수 없습니다.</p>}
          <p className="mt-3 t-caption text-finance-faint">섹터·통화 노출·소유자·계좌 기준은 헬스체크가 섹터를 채우는 3단계에서 추가합니다.</p>
        </article>
      </section>
    </InvestmentPageShell>
  )
}
