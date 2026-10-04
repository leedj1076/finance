import { redirect } from 'next/navigation'

import { formatMoney } from '@/features/investment/format'
import { KpiBand } from '@/features/investment/kpi-band'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getHoldingsData, getTrendData } from '@/features/investment/queries'
import { requireHousehold } from '@/lib/household'

export default async function InvestmentAdvisorPage() {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const [holdings, trend] = await Promise.all([getHoldingsData(household.householdId), getTrendData(household.householdId, '3m', 'total')])
  const cashPct = trend.allocation.filter((a) => a.label.includes('예수금')).reduce((s, a) => s + a.pct, 0)
  const kr = trend.allocation.find((a) => a.label === '국내 주식')?.pct ?? 0
  const us = trend.allocation.find((a) => a.label === '해외 주식')?.pct ?? 0
  const allocationKnown = holdings.groups.flatMap(group => group.markets.flatMap(m => m.rows)).filter(row => row.currency === 'KRW' || holdings.status.fx).every(row => row.marketValue !== null)
  const fxNote = holdings.status.fx ? '평가금액 기준' : '환율 없음 · 해외 미포함'
  return (
    <InvestmentPageShell active="investment-advisor" email={household.email} eyebrow="Advisor" title="어드바이저" subtitle="포트폴리오 리포트 · 종목 발굴"
      status={holdings.status} owners={[]} owner={null} ownerHref={() => '/investment/advisor'}>
      <KpiBand items={[
        { label: '최대 섹터 집중', value: '–', caption: '섹터는 헬스체크가 채웁니다 (3단계)' },
        { label: '현금 비중', value: allocationKnown ? `${cashPct.toFixed(1)}%` : '–', caption: <>{!allocationKnown && '시세 없음 · '}₩{formatMoney(holdings.summary.cashKRW, 'KRW')} · {formatMoney(holdings.summary.cashUSD, 'USD')}{!holdings.status.fx && <> · {fxNote}</>}</> },
        { label: '국내 · 해외', value: allocationKnown ? `${kr.toFixed(0)} · ${holdings.status.fx ? us.toFixed(0) : '–'}%` : '–', caption: allocationKnown ? fxNote : '시세 없음' },
        { label: '마지막 리포트', value: '–', caption: '아직 실행한 리포트가 없습니다' },
      ]} />
      <section className="border-b border-finance-border py-7">
        <h2 className="t-section text-finance-ink">포트폴리오 리포트</h2>
        <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">어드바이저는 로컬 Mac 워커와 Codex를 연결하는 3단계에서 켜집니다. 지금은 보유·거래·관심 데이터를 쌓아 두는 단계입니다.</p>
        <button className="h-[34px] bg-finance-ink px-4 t-body-strong text-white disabled:opacity-40" disabled title="3단계에서 연결" type="button">어드바이저 실행</button>
      </section>
      <section className="py-7">
        <h2 className="t-section text-finance-ink">종목 발굴</h2>
        <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">조건을 적어 후보 종목을 찾는 기능도 3단계에서 켜집니다.</p>
      </section>
    </InvestmentPageShell>
  )
}
