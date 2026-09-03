import Link from 'next/link'

import type { getCategoryPageData } from '@/features/analytics/category-page'
import type { getAnalysisData } from '@/features/analytics/queries'
import { formatRate, formatWon } from '@/lib/finance'

import { ledgerUrl, type LedgerFilters } from './filters'

type AnalysisData = Awaited<ReturnType<typeof getAnalysisData>>
type CategoryData = Awaited<ReturnType<typeof getCategoryPageData>>
type MonthTotals = {
  income: number
  expense: number
  saving: number
  netSaving: number
  savingsRate: number
}

const FLOW_LABELS = {
  expense: '지출',
  income: '수입',
  saving: '저축',
} as const

function SummaryCard({ label, value, note, tone = 'ink' }: {
  label: string
  value: string
  note?: string
  tone?: 'blue' | 'green' | 'ink' | 'red'
}) {
  const toneClass = {
    blue: 'text-finance-blue',
    green: 'text-finance-green',
    ink: 'text-finance-ink',
    red: 'text-finance-red',
  }[tone]
  return (
    <article className="px-4 py-5 first:pl-0 last:pr-0 sm:px-6">
      <p className="t-label uppercase text-finance-muted">{label}</p>
      <p className={`mt-2 t-kpi tabular-nums ${toneClass}`}>{value}</p>
      {note && <p className="mt-2 t-caption text-finance-muted">{note}</p>}
    </article>
  )
}

export function LedgerSummaryPanel({ data, monthTotals }: {
  data: AnalysisData
  monthTotals: MonthTotals
}) {
  const flowLabel = FLOW_LABELS[data.flow]
  const comparisonGood = data.delta !== 0 && (data.flow === 'expense' ? data.delta < 0 : data.delta > 0)
  return (
    <div className="mt-6">
      <section className="grid border-y border-finance-ink sm:grid-cols-2 sm:divide-x sm:divide-finance-hairline xl:grid-cols-4">
        <SummaryCard label="월 수입" tone="blue" value={`${formatWon(monthTotals.income)}원`} />
        <SummaryCard label="월 지출" tone="red" value={`${formatWon(monthTotals.expense)}원`} />
        <SummaryCard label="순저축" tone="green" value={`${formatWon(monthTotals.netSaving)}원`} note={`순저축률 ${formatRate(monthTotals.savingsRate)}%`} />
        <SummaryCard
          label={`${flowLabel} 전월 대비`}
          tone={data.delta === 0 ? 'ink' : comparisonGood ? 'green' : 'red'}
          value={data.delta === 0 ? '변동 없음' : `${data.delta > 0 ? '+' : '−'}${formatWon(Math.abs(data.delta))}원`}
          note={`${data.previousMonth} ${formatWon(data.previousTotal)}원${data.changeRate === null ? '' : ` · ${data.changeRate > 0 ? '+' : ''}${formatRate(data.changeRate)}%`}`}
        />
      </section>

      {data.anomalies.length > 0 && (
        <section className="mt-6 border-t border-finance-ink py-4">
          <h2 className="flex items-center gap-2 t-section text-finance-ink"><span className="h-[7px] w-[7px] bg-finance-amber" />평소보다 큰 지출</h2>
          <div className="mt-3 divide-y divide-finance-hairline">
            {data.anomalies.slice(0, 4).map((alert) => (
              <div className="py-3 t-body text-finance-ink" key={alert.major}>
                <strong>{alert.major}</strong> {formatWon(alert.current)}원 · 평소 약 {formatWon(alert.typical)}원
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <article className="border-t border-finance-ink pt-4">
          <h2 className="t-section text-finance-ink">가장 많이 변한 카테고리</h2>
          <div className="mt-3 divide-y divide-finance-hairline">
            {[...data.ranks]
              .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
              .slice(0, 6)
              .map((rank) => (
                <div className="flex items-center justify-between gap-4 py-3 t-body" key={rank.major}>
                  <span className="font-medium text-finance-ink">{rank.major}</span>
                  <span className={`tabular-nums ${rank.delta > 0 ? 'text-finance-red' : rank.delta < 0 ? 'text-finance-green' : 'text-finance-muted'}`}>
                    {rank.delta === 0 ? '변동 없음' : `${rank.delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(rank.delta))}원`}
                  </span>
                </div>
              ))}
            {data.ranks.length === 0 && <p className="py-10 text-center t-body text-finance-muted">비교할 거래가 없습니다.</p>}
          </div>
        </article>
        <article className="border-t border-finance-ink pt-4">
          <h2 className="t-section text-finance-ink">큰 거래 TOP 10</h2>
          <div className="mt-3 divide-y divide-finance-hairline">
            {data.topTransactions.map((transaction, index) => (
              <div className="flex items-center gap-3 py-3" key={transaction.id}>
                <span className="w-5 t-caption text-finance-faint">{index + 1}</span>
                <div className="min-w-0 flex-1"><p className="truncate t-body font-medium text-finance-ink">{transaction.merchant || transaction.major}</p><p className="mt-0.5 t-caption text-finance-muted">{transaction.date} · {transaction.major}{transaction.accountName ? ` · ${transaction.accountName}` : ''}</p></div>
                <span className="shrink-0 t-body-strong tabular-nums text-finance-ink">{formatWon(transaction.amount)}원</span>
              </div>
            ))}
            {data.topTransactions.length === 0 && <p className="py-10 text-center t-body text-finance-muted">거래가 없습니다.</p>}
          </div>
        </article>
      </section>
    </div>
  )
}

export function LedgerCategoriesPanel({ data, detail, filters }: {
  data: AnalysisData
  detail: CategoryData | null
  filters: LedgerFilters
}) {
  const maxRank = data.ranks[0]?.amount ?? 1
  return (
    <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(300px,0.7fr)_minmax(0,1.3fr)]">
      <section className="border-t border-finance-ink pt-4">
        <h2 className="t-section text-finance-ink">카테고리 순위</h2>
        <p className="mt-1 t-caption text-finance-muted">카테고리를 선택하면 이 화면에서 소분류와 가맹점을 펼칩니다.</p>
        <div className="mt-5 space-y-4">
          {data.ranks.map((rank, index) => (
            <div key={rank.major}>
              <div className="grid grid-cols-[24px_minmax(90px,1fr)_auto] items-center gap-2 t-body">
                <span className="text-finance-faint">{index + 1}</span>
                <Link className={`truncate font-medium ${filters.major === rank.major ? 'text-finance-blue' : 'text-finance-ink hover:text-finance-blue'}`} href={ledgerUrl(data.month, { ...filters, major: rank.major }, { tab: 'categories' })}>{rank.major}</Link>
                <div className="text-right"><p className="font-semibold tabular-nums text-finance-ink">{formatWon(rank.amount)}원</p><p className={`mt-0.5 t-caption ${rank.delta > 0 ? 'text-finance-red' : rank.delta < 0 ? 'text-finance-green' : 'text-finance-faint'}`}>{rank.delta === 0 ? '–' : `${rank.delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(rank.delta))}원`}</p></div>
              </div>
              <div className="ml-8 mt-2 h-[5px] overflow-hidden bg-finance-track"><div className="h-full bg-finance-blue" style={{ width: `${(rank.amount / maxRank) * 100}%` }} /></div>
            </div>
          ))}
          {data.ranks.length === 0 && <p className="py-10 text-center t-body text-finance-muted">이 필터에는 거래가 없습니다.</p>}
        </div>
      </section>

      <section className="border-t border-finance-ink pt-4">
        {!detail || !filters.major ? (
          <div className="grid min-h-56 place-items-center border-y border-finance-hairline text-center">
            <div><p className="t-body-strong text-finance-ink">왼쪽에서 카테고리를 선택하세요</p><p className="mt-1 t-caption text-finance-muted">소분류·가맹점 구성과 해당 거래를 한 번에 확인할 수 있습니다.</p></div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-finance-hairline pb-4">
              <div><p className="t-caption text-finance-muted">선택 카테고리</p><h2 className="mt-1 t-section text-finance-ink">{filters.major}</h2><p className="mt-1 t-caption text-finance-muted">{detail.transactions.length}건 · 전체 대비 {formatRate(detail.percent)}%</p></div>
              <Link className="h-[30px] bg-finance-ink px-3 py-1.5 t-body-strong text-white hover:bg-finance-blue" href={ledgerUrl(data.month, filters, { tab: 'list' })}>거래 보기 →</Link>
            </div>
            <div className="grid gap-6 pt-5 md:grid-cols-2">
              <div><h3 className="t-label uppercase text-finance-muted">소분류</h3><div className="mt-2 divide-y divide-finance-hairline">{detail.subs.map((sub) => <div className="flex justify-between gap-3 py-3 t-body" key={sub.sub}><span>{sub.sub} <small className="text-finance-faint">{sub.count}건</small></span><strong className="tabular-nums">{formatWon(sub.amount)}원</strong></div>)}</div></div>
              <div><h3 className="t-label uppercase text-finance-muted">가맹점</h3><div className="mt-2 divide-y divide-finance-hairline">{detail.merchants.map((merchant) => <div className="flex justify-between gap-3 py-3 t-body" key={merchant.name}><span className="truncate">{merchant.name} <small className="text-finance-faint">{merchant.count}건</small></span><strong className="shrink-0 tabular-nums">{formatWon(merchant.amount)}원</strong></div>)}</div></div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export function LedgerMerchantsPanel({ data, filters }: {
  data: AnalysisData
  filters: LedgerFilters
}) {
  return (
    <section className="mt-6 overflow-hidden border-t border-finance-ink">
      <div className="border-b border-finance-hairline py-4"><h2 className="t-section text-finance-ink">가맹점별 지출</h2><p className="mt-1 t-caption text-finance-muted">가맹점을 누르면 같은 필터를 유지한 채 거래 목록으로 이동합니다.</p></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left t-body">
          <thead className="border-b border-finance-hairline bg-finance-panel t-label uppercase text-finance-muted"><tr><th className="px-5 py-3 font-semibold">#</th><th className="px-3 py-3 font-semibold">가맹점</th><th className="px-3 py-3 text-right font-semibold">건수</th><th className="px-3 py-3 text-right font-semibold">이번 달</th><th className="px-3 py-3 text-right font-semibold">지난달</th><th className="px-5 py-3 text-right font-semibold">증감</th></tr></thead>
          <tbody className="divide-y divide-finance-hairline">
            {data.merchants.map((merchant, index) => (
              <tr key={merchant.name}>
                <td className="px-5 py-3 text-finance-faint">{index + 1}</td>
                <td className="px-3 py-3 font-medium"><Link className="text-finance-ink hover:text-finance-blue" href={ledgerUrl(data.month, { ...filters, q: merchant.name }, { tab: 'list' })}>{merchant.name}</Link></td>
                <td className="px-3 py-3 text-right text-finance-muted">{merchant.count}건</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatWon(merchant.amount)}원</td>
                <td className="px-3 py-3 text-right tabular-nums text-finance-muted">{merchant.previous ? `${formatWon(merchant.previous)}원` : '–'}</td>
                <td className={`px-5 py-3 text-right tabular-nums ${merchant.delta > 0 ? 'text-finance-red' : merchant.delta < 0 ? 'text-finance-green' : 'text-finance-faint'}`}>{merchant.delta === 0 ? '–' : `${merchant.delta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(merchant.delta))}원`}</td>
              </tr>
            ))}
            {data.merchants.length === 0 && <tr><td className="px-5 py-12 text-center text-finance-muted" colSpan={6}>조건에 맞는 가맹점 지출이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
