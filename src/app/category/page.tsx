import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import {
  getCategoryPageData,
  parseCategoryPageParams,
} from '@/features/analytics/category-page'
import { categoryAnalysisUrl } from '@/features/analytics/category-url'
import { formatRate, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type CategoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const FLOW_LABELS = {
  expense: '지출',
  income: '수입',
  saving: '저축',
} as const

function transactionLabel(flow: keyof typeof FLOW_LABELS, fixed: boolean) {
  if (flow === 'expense') return fixed ? '고정지출' : '변동지출'
  return FLOW_LABELS[flow]
}

export default async function CategoryPage({ searchParams }: CategoryPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const parsed = parseCategoryPageParams(await searchParams)
  const data = await getCategoryPageData(household.householdId, parsed)
  const flowLabel = FLOW_LABELS[data.flow]
  const period = data.period === 'month'
    ? { month: data.month }
    : { year: data.year }
  const backUrl = categoryAnalysisUrl({
    flow: data.flow,
    period,
    accountId: data.accountId,
  })

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="analysis" email={household.email} />
      <main className="mx-auto max-w-none px-5 pb-12 pt-10 sm:px-12">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">분류 상세</p>
            <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">
              {data.major || '분류 미선택'}
            </h1>
            <p className="mt-2 text-xs text-finance-muted">
              {data.label} · {flowLabel}
              {data.selectedAccount ? ` · ${data.selectedAccount.name}` : ''}
            </p>
          </div>
          <Link
            className="inline-flex h-[34px] items-center self-start border border-finance-hairline bg-white px-4 text-xs font-semibold text-finance-ink hover:bg-finance-panel sm:self-auto"
            href={backUrl}
          >
            ← 분석으로
          </Link>
        </div>

        <section className="mt-6 grid border-y border-finance-ink sm:grid-cols-2 sm:divide-x sm:divide-finance-hairline">
          <article className="px-4 py-5 first:pl-0 sm:px-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-finance-muted">{data.major || '선택 분류'} 합계</p>
            <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums text-finance-ink">
              {formatWon(data.categoryTotal)}원
            </p>
          </article>
          <article className="px-4 py-5 last:pr-0 sm:px-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-finance-muted">{flowLabel} 대비 비중</p>
            <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums text-finance-green">
              {formatRate(data.percent)}%
            </p>
            <p className="mt-2 text-xs text-zinc-500">기간 전체 {flowLabel} {formatWon(data.periodTotal)}원</p>
          </article>
        </section>

        <section className="mt-6 overflow-hidden border-t border-finance-ink">
          <div className="border-b border-finance-hairline py-4">
            <h2 className="text-sm font-bold text-finance-ink">소분류별</h2>
          </div>
          {data.subs.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-zinc-500">거래가 없습니다.</p>
          ) : (
            <ol className="divide-y divide-finance-hairline">
              {data.subs.map((sub, index) => (
                <li className="grid grid-cols-[24px_minmax(100px,1fr)_auto] items-center gap-3 py-4" key={sub.sub}>
                  <span className="text-xs text-zinc-400">{index + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-zinc-800">{sub.sub}</p>
                      <span className="shrink-0 text-xs text-zinc-500">{sub.count}건</span>
                    </div>
                    <div className="mt-2 h-[5px] overflow-hidden bg-finance-track">
                      <div
                        className="h-full bg-finance-blue"
                        style={{ width: `${data.categoryTotal > 0 ? (sub.amount / data.categoryTotal) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-zinc-950">{formatWon(sub.amount)}원</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {data.merchants.length > 0 && (
          <section className="mt-6 overflow-hidden border-t border-finance-ink">
            <div className="border-b border-finance-hairline py-4">
              <h2 className="text-sm font-bold text-finance-ink">가맹점 TOP {data.merchants.length}</h2>
              <p className="mt-1 text-xs text-zinc-500">공백·지점번호를 제거해 같은 가맹점으로 묶었습니다.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="border-b border-finance-hairline bg-finance-panel text-[11px] font-semibold uppercase tracking-[0.06em] text-finance-muted">
                  <tr>
                    <th className="px-5 py-3 font-medium">#</th>
                    <th className="px-3 py-3 font-medium">가맹점</th>
                    <th className="px-3 py-3 text-right font-medium">건수</th>
                    <th className="px-5 py-3 text-right font-medium">합계</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-finance-hairline">
                  {data.merchants.map((merchant, index) => (
                    <tr key={`${merchant.name}-${index}`}>
                      <td className="px-5 py-3 text-zinc-400">{index + 1}</td>
                      <td className="px-3 py-3 font-medium text-zinc-800">{merchant.name}</td>
                      <td className="px-3 py-3 text-right text-zinc-500">{merchant.count}건</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-zinc-950">{formatWon(merchant.amount)}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mt-6 overflow-hidden border-t border-finance-ink">
          <div className="flex items-center justify-between border-b border-finance-hairline py-4">
            <h2 className="text-sm font-bold text-finance-ink">거래 내역</h2>
            <span className="text-sm text-zinc-500">{data.transactions.length.toLocaleString('ko-KR')}건</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-finance-hairline bg-finance-panel text-[11px] font-semibold uppercase tracking-[0.06em] text-finance-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">날짜</th>
                  <th className="px-3 py-3 font-medium">구분</th>
                  <th className="px-3 py-3 font-medium">소분류</th>
                  <th className="px-3 py-3 font-medium">사용내역</th>
                  <th className="px-3 py-3 text-right font-medium">금액</th>
                  <th className="px-5 py-3 font-medium">결제수단</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-finance-hairline">
                {data.transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums text-zinc-500">{transaction.date}</td>
                    <td className="px-3 py-3">
                      <span className="whitespace-nowrap bg-finance-track px-2 py-1 text-[11px] font-semibold text-finance-muted">
                        {transactionLabel(transaction.flow, transaction.fixed)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-zinc-700">{transaction.sub}</td>
                    <td className="max-w-xs truncate px-3 py-3 text-zinc-800" title={transaction.memo}>{transaction.memo || '–'}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-zinc-950">{formatWon(transaction.amount)}원</td>
                    <td className="px-5 py-3 text-zinc-600">{transaction.accountName || '–'}</td>
                  </tr>
                ))}
                {data.transactions.length === 0 && (
                  <tr>
                    <td className="px-5 py-12 text-center text-sm text-zinc-500" colSpan={6}>거래가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
