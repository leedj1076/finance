import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { formatMoney, formatPct, formatSigned } from '@/features/investment/format'
import { HoldingMemoForm } from '@/features/investment/holding-memo-form'
import { KpiBand } from '@/features/investment/kpi-band'
import { MarketChip } from '@/features/investment/market-chip'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getSecurityDetail, loadPortfolioInputs } from '@/features/investment/queries'
import { TransactionsTable } from '@/features/investment/transactions-table'
import { TrendChart } from '@/features/investment/trend-chart'
import { requireHousehold } from '@/lib/household'

type Props = { params: Promise<{ securityId: string }> }

export default async function InvestmentSecurityPage({ params }: Props) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const { securityId } = await params
  const id = Number(securityId)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  const [detail, inputs] = await Promise.all([getSecurityDetail(household.householdId, id), loadPortfolioInputs(household.householdId)])
  if (!detail) notFound()
  const { security, positions } = detail
  const c = security.currency
  const quantity = positions.reduce((s, p) => s + p.quantity, 0)
  const cost = positions.reduce((s, p) => s + p.costBasis, 0)
  const costKnown = positions.every(p => p.avgCost !== null)
  const avg = quantity > 0 && costKnown ? cost / quantity : null
  const value = positions.every((p) => p.marketValue !== null) ? positions.reduce((s, p) => s + (p.marketValue ?? 0), 0) : null
  const unrealized = value === null || !costKnown ? null : positions.reduce((sum, p) => sum + (p.unrealized ?? 0), 0)
  const weight = positions[0]?.weightPct ?? null
  const byOwner = positions.map((p) => `${inputs.accounts.find((a) => a.id === p.accountId)?.owner ?? '?'} ${p.quantity}`).join(' · ')
  const discrepancy = positions.find((p) => p.discrepancy)?.discrepancy ?? null
  return (
    <InvestmentPageShell active="investment" email={household.email} eyebrow={`${security.market} · ${security.symbol}${security.businessType ? ` · ${security.businessType}` : ''}`} title={security.name}
      subtitle={<>{detail.price === null ? '시세 없음' : <>{formatMoney(detail.price, c)}{c === 'KRW' ? '원' : ''} <span className={detail.changeRate === null ? 'text-finance-faint' : detail.changeRate >= 0 ? 'text-finance-blue' : 'text-finance-red'}>{formatPct(detail.changeRate)}</span></>}</>}
      status={{ quotedAt: inputs.quotedAt, fx: inputs.fx, lastSyncedAt: inputs.lastSyncedAt, workerConnected: false }} owners={[]} owner={null} ownerHref={() => '/investment'}>
      <nav className="mt-3 flex flex-wrap items-center gap-3 t-caption text-finance-muted" aria-label="이동">
        <Link className="font-semibold text-finance-blue" href="/investment">‹ 보유</Link>
        <span className="ml-auto flex gap-3">
          {detail.neighbors.prev && <Link className="font-semibold text-finance-blue" href={`/investment/${detail.neighbors.prev.id}`}>‹ {detail.neighbors.prev.name}</Link>}
          {detail.neighbors.next && <Link className="font-semibold text-finance-blue" href={`/investment/${detail.neighbors.next.id}`}>{detail.neighbors.next.name} ›</Link>}
        </span>
      </nav>
      <KpiBand items={[
        { label: '보유', value: quantity === 0 ? '미보유' : <>{quantity}<span className="ml-1 t-body font-medium text-finance-muted">주</span></>, caption: quantity === 0 ? (security.watching ? '관심 종목' : '') : <>{byOwner}{weight !== null && <> · 비중 {weight.toFixed(1)}% (주식 계좌 기준)</>}</> },
        { label: '평균단가', value: avg === null ? '–' : formatMoney(avg, c), caption: !costKnown ? '단가 없음' : discrepancy ? <span className="text-finance-amber">증권사 {formatMoney(discrepancy.brokerAvg, c)}{discrepancy.qtyDiffers ? ` · 수량 ${discrepancy.brokerQty}주` : ` · ${discrepancy.avgDiffPct?.toFixed(1)}% 차이`}</span> : '이동평균' },
        { label: '평가손익', value: unrealized === null ? '–' : formatSigned(unrealized, c), tone: unrealized === null ? 'ink' : unrealized >= 0 ? 'blue' : 'red', caption: value === null ? '시세 없음' : !costKnown ? '단가 없음' : <>{formatPct(cost === 0 ? null : unrealized! / cost * 100)} · 평가 {formatMoney(value, c)}</> },
        { label: '다음 점검', value: security.nextCheckDate ? security.nextCheckDate.slice(5) : '–', caption: '헬스체크는 3단계에서 연결' },
      ]} />
      <div className="grid gap-8 py-7 xl:grid-cols-[1.6fr_1fr]">
        <article className="min-w-0">
          <MarketChip market={security.market} />
          <h2 className="mt-3 t-section text-finance-ink">헬스체크</h2>
          <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">세 판정(기업 상태 · 가격 부담 · 보유 적합성), 매수 논지 검증, 기업 상태 5영역, 밸류에이션 역산은 로컬 워커와 Codex를 연결하는 3단계에서 이 자리에 표시됩니다. 지금은 아래 보유 메모를 채워 두면 첫 리포트의 입력이 됩니다.</p>
          <button className="h-[34px] bg-finance-ink px-4 t-body-strong text-white disabled:opacity-40" disabled title="3단계에서 연결" type="button">헬스체크 실행</button>
          <h3 className="mt-8 t-section text-finance-ink">이 종목 거래</h3>
          <TransactionsTable rows={detail.transactions} />
        </article>
        <aside className="min-w-0 xl:border-l xl:border-finance-border xl:pl-8">
          <div className="flex items-baseline justify-between"><h3 className="t-section text-finance-ink">보유 메모</h3><span className="t-caption text-finance-faint">헬스체크 v3 입력</span></div>
          <div className="mt-3"><HoldingMemoForm security={{ id: security.id, thesis: security.thesis, horizonYears: security.horizonYears, fundsNeededAt: security.fundsNeededAt, lossLimitPct: security.lossLimitPct, weightBasis: security.weightBasis }} /></div>
          <p className="mt-3 t-caption text-finance-faint">매수 논지가 없으면 리포트가 공시를 바탕으로 가설 초안을 만들되 사용자 논지로 단정하지 않습니다. 손실 한도가 없으면 임의로 만들지 않습니다.</p>
          <h3 className="mt-8 t-section text-finance-ink">가격 · 3개월</h3>
          {detail.priceHistory.length > 0
            ? <div className="mt-4"><TrendChart priceChart scope={security.market} points={detail.priceHistory.map(p => ({ date: p.date, value: p.close, cost: avg }))} /><p className="mt-2 t-caption text-finance-muted">종가 · 점선은 현재 평균단가</p></div>
            : <p className="mt-3 border-t border-finance-border py-4 t-caption text-finance-muted">일별 종가가 없습니다. 키움 연동(2단계) 후 가격과 평균단가를 비교합니다.</p>}
        </aside>
      </div>
    </InvestmentPageShell>
  )
}
