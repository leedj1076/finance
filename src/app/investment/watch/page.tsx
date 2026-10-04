import Link from 'next/link'
import { redirect } from 'next/navigation'

import { formatMoney, formatPct } from '@/features/investment/format'
import { KpiBand } from '@/features/investment/kpi-band'
import { MarketChip } from '@/features/investment/market-chip'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getWatchData, loadPortfolioInputs } from '@/features/investment/queries'
import { WatchForm } from '@/features/investment/watch-form'
import { requireHousehold } from '@/lib/household'

export default async function InvestmentWatchPage() {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const [rows, inputs] = await Promise.all([getWatchData(household.householdId), loadPortfolioInputs(household.householdId)])
  const kr = rows.filter((r) => r.security.market === 'KR').length
  const us = rows.length - kr
  return (
    <InvestmentPageShell active="investment-watch" email={household.email} eyebrow="Watchlist" title="관심" subtitle={`국내 ${kr} · 해외 ${us}`}
      status={{ quotedAt: inputs.quotedAt, fx: inputs.fx, lastSyncedAt: inputs.lastSyncedAt, workerConnected: false }}
      owners={[]} owner={null} ownerHref={() => '/investment/watch'}>
      <KpiBand items={[
        { label: '관심 종목', value: String(rows.length), caption: `국내 ${kr} · 해외 ${us}` },
        { label: '점검 예정 7일 내', value: '0', caption: '헬스체크는 3단계에서 연결' },
        { label: '미실행', value: String(rows.length), caption: '헬스체크 없음' },
        { label: '발굴 후보 대기', value: '0', caption: '발굴은 3단계에서 연결' },
      ]} />
      <section className="py-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="t-section text-finance-ink">관심 종목</h2><p className="mt-1 t-caption text-finance-faint">미보유 · 매수하면 보유로 옮겨집니다</p></div>
          <WatchForm />
        </div>
        {rows.length === 0 ? <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">관심 종목이 없습니다.</p> : (
          <div className="mt-4 overflow-x-auto border-t border-finance-ink">
            <table className="w-full t-body">
              <thead className="border-b border-finance-border t-label uppercase text-finance-muted"><tr><th className="py-2.5 text-left">종목</th><th className="px-3 py-2.5 text-right">현재가</th><th className="px-3 py-2.5 text-right">등락</th><th className="py-2.5 pl-3 text-right">판정</th></tr></thead>
              <tbody className="divide-y divide-finance-track">
                {rows.map((row) => (
                  <tr key={row.security.id}>
                    <td className="py-3 pr-3"><Link className="t-body-strong text-finance-ink" href={`/investment/${row.security.id}`}><MarketChip market={row.security.market} />{row.security.name} <span className="t-caption font-normal text-finance-faint">{row.security.symbol}</span></Link></td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.price === null ? '–' : formatMoney(row.price, row.security.currency)}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${row.changeRate === null ? 'text-finance-faint' : row.changeRate >= 0 ? 'text-finance-blue' : 'text-finance-red'}`}>{formatPct(row.changeRate)}</td>
                    <td className="py-3 pl-3 text-right t-caption text-finance-faint">미실행</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </InvestmentPageShell>
  )
}
