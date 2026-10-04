import Link from 'next/link'
import { redirect } from 'next/navigation'

import { formatMoney, formatPct, formatSigned } from '@/features/investment/format'
import { HoldingsTable } from '@/features/investment/holdings-table'
import { KpiBand } from '@/features/investment/kpi-band'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getHoldingsData, loadPortfolioInputs } from '@/features/investment/queries'
import { requireHousehold } from '@/lib/household'

type Props = { searchParams: Promise<{ owner?: string | string[]; market?: string | string[] }> }

function href(market: string, owner: string | null) {
  const params = new URLSearchParams({ market })
  if (owner) params.set('owner', owner)
  return `/investment?${params}`
}

export default async function InvestmentHoldingsPage({ searchParams }: Props) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const params = await searchParams
  const owner = typeof params.owner === 'string' && params.owner !== '' ? params.owner : null
  const market = params.market === 'kr' || params.market === 'us' ? params.market : 'all'
  const [data, inputs] = await Promise.all([getHoldingsData(household.householdId, owner ?? undefined), loadPortfolioInputs(household.householdId)])
  const owners = [...new Set(inputs.accounts.filter(a => a.active).map((a) => a.owner))]
  const { summary } = data
  const fxNote = summary.fxMissing ? ' · 환율 없음 · 해외 미포함' : ''
  const rows = data.groups.flatMap(group => group.markets.flatMap(m => m.rows))
  const totalRows = rows.filter(row => row.currency === 'KRW' || data.status.fx)
  const priced = (items: typeof rows) => items.every(row => row.marketValue !== null)
  const profitKnown = (items: typeof rows) => items.every(row => row.unrealized !== null)
  const marketKpi = (key: 'KR' | 'US') => {
    const groupRows = rows.filter(row => row.market === key)
    const currency = key === 'KR' ? 'KRW' : 'USD'
    const value = summary[key]
    return {
      label: key === 'KR' ? '국내 평가' : '해외 평가',
      value: priced(groupRows) ? <>{formatMoney(value.value, currency)}{key === 'KR' && <span className="ml-1 t-body font-medium text-finance-muted">원</span>}</> : '–',
      caption: <>{!priced(groupRows) ? '시세 없음' : !profitKnown(groupRows) ? '단가 없음' : <>손익 <strong className={value.unrealized > 0 ? 'text-finance-blue' : value.unrealized < 0 ? 'text-finance-red' : 'text-finance-ink'}>{formatSigned(value.unrealized, currency)} · {formatPct(value.returnPct)}</strong></>}{key === 'US' && data.status.fx && priced(groupRows) && <> · ₩{formatMoney(value.value * data.status.fx.rate, 'KRW')} 환산</>} · {value.count}종목</>,
    }
  }
  return (
    <InvestmentPageShell
      active="investment" email={household.email} eyebrow="Holdings" title="보유"
      subtitle={`${data.groups.length}계좌 · 국내 ${data.securitiesCount.KR} · 해외 ${data.securitiesCount.US} 종목`}
      status={data.status} owners={owners} owner={owner} ownerHref={(value) => href(market, value)}
    >
      <KpiBand items={[
        marketKpi('KR'), marketKpi('US'),
        { label: '합계 (원화 환산)', value: priced(totalRows) ? <>{formatMoney(summary.totalKRW, 'KRW')}<span className="ml-1 t-body font-medium text-finance-muted">원</span></> : '–', caption: <>{!priced(totalRows) ? '시세 없음' : !profitKnown(totalRows) ? '단가 없음' : <>손익 <strong className={summary.totalUnrealizedKRW >= 0 ? 'text-finance-blue' : 'text-finance-red'}>{formatSigned(summary.totalUnrealizedKRW, 'KRW')}</strong></>}{fxNote} · 예수금 포함</> },
        { label: '예수금', value: `₩${formatMoney(summary.cashKRW, 'KRW')}`, caption: <><strong className="text-finance-ink">{formatMoney(summary.cashUSD, 'USD')}</strong>{data.groups.map((g) => <span key={g.account.id}> · {g.account.owner} ₩{formatMoney(g.cashKRW, 'KRW')} / {formatMoney(g.cashUSD, 'USD')}</span>)}</> },
      ]} />

      {data.attention.length > 0 && (
        <section aria-label="주의 필요" className="border-b border-finance-border">
          {data.attention.map((item) => (
            <Link className="flex min-h-12 flex-col gap-1 border-b border-finance-track py-3 t-body last:border-b-0 sm:flex-row sm:items-center sm:gap-3" href={item.href} key={`${item.kind}-${item.securityId}`}>
              <span aria-hidden className="h-[7px] w-[7px] shrink-0 bg-finance-amber" />
              <strong className="text-finance-ink">{item.title}</strong>
              <span className="t-caption text-finance-muted">{item.detail}</span>
              <span className="ml-auto shrink-0 t-caption font-semibold text-finance-blue">보기 →</span>
            </Link>
          ))}
        </section>
      )}

      <section className="py-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><h2 className="t-section text-finance-ink">보유 종목</h2><p className="mt-1 t-caption text-finance-faint">계좌별 · 평가손익은 이동평균 단가 기준 · 행을 누르면 상세</p></div>
          <div className="flex border border-finance-border" role="group" aria-label="시장">
            {(['all', 'kr', 'us'] as const).map(value => <Link aria-current={market === value ? 'true' : undefined} className={`flex h-[34px] items-center border-r border-finance-border px-3 t-caption-strong last:border-r-0 ${market === value ? 'bg-finance-track text-finance-ink' : 'text-finance-muted'}`} href={href(value, owner)} key={value}>{value === 'all' ? '전체' : value === 'kr' ? '국내' : '해외'}</Link>)}
          </div>
        </div>
        <p className="mt-2 t-caption text-finance-muted">{market === 'kr' ? '국내 소계 · 원화' : market === 'us' ? '해외 소계 · 달러' : '국내는 원화, 해외는 달러'} · 비중은 원화 환산 기준</p>
        {data.groups.length === 0
          ? <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">계좌가 없습니다. <Link className="font-semibold text-finance-blue" href="/investment/settings">투자 설정에서 계좌를 추가</Link>한 뒤 <Link className="font-semibold text-finance-blue" href="/investment/transactions">거래</Link>에서 매수를 입력하세요.</p>
          : <HoldingsTable householdId={household.householdId} fx={data.status.fx} groups={data.groups} market={market === 'kr' ? 'KR' : market === 'us' ? 'US' : 'all'} />}
      </section>
    </InvestmentPageShell>
  )
}
