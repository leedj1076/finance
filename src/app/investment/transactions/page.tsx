import Link from 'next/link'
import { redirect } from 'next/navigation'

import { formatMoney, formatSigned } from '@/features/investment/format'
import { KpiBand } from '@/features/investment/kpi-band'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getTransactionsData, loadPortfolioInputs } from '@/features/investment/queries'
import { ManualTransactionForm } from '@/features/investment/transaction-form'
import { TransactionsTable } from '@/features/investment/transactions-table'
import type { Market } from '@/features/investment/types'
import { currentMonthInKorea, isMonthKey, shiftMonth } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type Props = { searchParams: Promise<{ month?: string | string[]; market?: string | string[]; owner?: string | string[] }> }

function href(month: string, market: string, owner: string | null) {
  const params = new URLSearchParams({ month, market })
  if (owner) params.set('owner', owner)
  return `/investment/transactions?${params.toString()}`
}

export default async function InvestmentTransactionsPage({ searchParams }: Props) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const params = await searchParams
  const month = isMonthKey(typeof params.month === 'string' ? params.month : undefined) ? (params.month as string) : currentMonthInKorea()
  const marketRaw = typeof params.market === 'string' ? params.market : 'all'
  const market: Market | 'all' = marketRaw === 'KR' || marketRaw === 'US' ? marketRaw : 'all'
  const owner = typeof params.owner === 'string' && params.owner !== '' ? params.owner : null
  const [data, inputs] = await Promise.all([getTransactionsData(household.householdId, month, market, owner ?? undefined), loadPortfolioInputs(household.householdId)])
  const owners = [...new Set(inputs.accounts.map((a) => a.owner))]
  const activeAccounts = inputs.accounts.filter(a => a.active)
  const unknownRealized = (currency: 'KRW' | 'USD') => data.rows.some(row => row.kind === 'sell' && row.currency === currency && row.realized === null)
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  const tone = (value: number) => value > 0 ? 'blue' as const : value < 0 ? 'red' as const : 'ink' as const
  return (
    <InvestmentPageShell active="investment-transactions" email={household.email} eyebrow="Transactions" title="거래" subtitle="매수·매도·배당·입출금 · 실현손익"
      status={{ quotedAt: inputs.quotedAt, fx: inputs.fx, lastSyncedAt: inputs.lastSyncedAt, workerConnected: false }}
      owners={owners} owner={owner} ownerHref={(value) => href(month, market, value)}>
      <KpiBand items={[
        { label: `${Number(month.slice(5))}월 실현손익 · 국내`, value: unknownRealized('KRW') ? '–' : <>{formatSigned(data.realizedKRW, 'KRW')}<span className="ml-1 t-body font-medium text-finance-muted">원</span></>, tone: tone(data.realizedKRW), caption: unknownRealized('KRW') ? '단가 없음 · 실현손익 미확정' : '매도 기준 · 수수료·세금 차감 후' },
        { label: `${Number(month.slice(5))}월 실현손익 · 해외`, value: unknownRealized('USD') ? '–' : formatSigned(data.realizedUSD, 'USD'), tone: tone(data.realizedUSD), caption: unknownRealized('USD') ? '단가 없음 · 실현손익 미확정' : '달러 기준' },
        { label: '배당', value: `₩${formatMoney(data.dividendKRW, 'KRW')}`, caption: <><strong className="text-finance-ink">{formatMoney(data.dividendUSD, 'USD')}</strong> · 입력 금액 기준</> },
        { label: '순입출금', value: <>{formatSigned(data.netCashKRW, 'KRW')}<span className="ml-1 t-body font-medium text-finance-muted">원</span></>, caption: <>달러 {formatSigned(data.netCashUSD, 'USD')}</> },
      ]} />
      <section className="relative py-7">
        <div className="flex flex-wrap items-center justify-between gap-3 min-[861px]:pr-[100px]">
          <div className="flex items-center border border-finance-ink">
            <Link aria-label="이전 달" className="grid h-[34px] w-[34px] place-items-center border-r border-finance-ink hover:bg-finance-track" href={href(shiftMonth(month, -1), market, owner)}>←</Link>
            <span className="px-4 t-body-strong">{month.slice(0, 4)}년 {Number(month.slice(5))}월</span>
            <Link aria-label="다음 달" className="grid h-[34px] w-[34px] place-items-center border-l border-finance-ink hover:bg-finance-track" href={href(shiftMonth(month, 1), market, owner)}>→</Link>
          </div>
          <div className="flex border border-finance-border" role="group" aria-label="시장">
            {(['all', 'KR', 'US'] as const).map((value) => (
              <Link aria-current={market === value ? 'true' : undefined} className={`flex h-[34px] items-center border-r border-finance-border px-3 t-caption-strong last:border-r-0 ${market === value ? 'bg-finance-track text-finance-ink' : 'text-finance-muted'}`} href={href(month, value, owner)} key={value}>
                {value === 'all' ? '전체' : value === 'KR' ? '국내' : '해외'}
              </Link>
            ))}
          </div>
        </div>
        {activeAccounts.length === 0
          ? <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted"><Link className="font-semibold text-finance-blue" href="/investment/settings">계좌를 먼저 추가</Link>하세요.</p>
          : <details className="mt-3 min-[861px]:mt-0"><summary className="inline-flex h-[34px] cursor-pointer items-center border border-finance-ink px-3 t-caption-strong text-finance-ink min-[861px]:absolute min-[861px]:right-0 min-[861px]:top-7">거래 추가</summary><ManualTransactionForm accounts={activeAccounts} securities={inputs.securities} today={today} /></details>}
        <TransactionsTable rows={data.rows} />
        <p className="mt-3 t-caption text-finance-faint">키움에서 온 행은 메모만 수정할 수 있습니다. 예수금이 증권사와 다르면 입금·출금 행으로, 수량·단가가 다르면 정정 행으로 맞춥니다. 환전은 원화 출금 + 달러 입금 두 행으로 기록합니다.</p>
      </section>
    </InvestmentPageShell>
  )
}
