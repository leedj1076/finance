import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SubmitButton } from '@/components/submit-button'
import { AssetForm } from '@/features/assets/asset-form'
import { NetWorthChart } from '@/features/assets/net-worth-chart'
import { getAssetData } from '@/features/assets/queries'
import { formatRate, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type AssetsPageProps = {
  searchParams: Promise<{ month?: string | string[]; saved?: string | string[] }>
}

function SummaryCard({ label, value, description, tone = 'default' }: {
  label: string
  value: string
  description?: string
  tone?: 'asset' | 'debt' | 'default' | 'good'
}) {
  const color = tone === 'asset'
    ? 'text-blue-700'
    : tone === 'debt'
      ? 'text-rose-700'
      : tone === 'good'
        ? 'text-emerald-700'
        : 'text-zinc-950'
  return (
    <article className="px-4 py-5 first:pl-0 last:pr-0 sm:px-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-finance-muted">{label}</p>
      <p className={`mt-2 text-[26px] font-semibold leading-none tabular-nums ${color}`}>{value}</p>
      {description && <p className="mt-2 text-xs text-finance-muted">{description}</p>}
    </article>
  )
}

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const params = await searchParams
  const requestedMonth = typeof params.month === 'string' ? params.month : undefined
  const saved = params.saved === '1'
  const data = await getAssetData(household.householdId, requestedMonth)
  const deltaLabel = data.netWorthDelta === 0
    ? '전월과 동일'
    : `전월보다 ${formatWon(Math.abs(data.netWorthDelta))}원 ${data.netWorthDelta > 0 ? '증가' : '감소'}`
  const maxComposition = data.composition[0]?.amount ?? 1

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="assets" email={household.email} />
      <main className="mx-auto max-w-none px-5 pb-12 pt-10 sm:px-12">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">재무 상태</p>
            <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">자산</h1>
            <p className="mt-2 text-xs text-finance-muted">{data.month} · 순자산 = 총자산 − 부채</p>
          </div>
          <div className="flex items-center gap-2">
            <Link aria-label="이전 달" className="grid h-[34px] w-[34px] place-items-center border border-finance-hairline bg-white text-finance-ink hover:bg-finance-panel" href={`/assets?month=${data.previousMonth}`}>←</Link>
            <form action="/assets" className="flex items-center gap-2">
              <input aria-label="자산 기준 월" className="h-[34px] border border-finance-hairline bg-white px-3 text-[13px] text-finance-ink" defaultValue={data.month} name="month" type="month" />
              <SubmitButton className="h-[34px] bg-finance-ink px-3 text-[13px] font-semibold text-white hover:opacity-80 disabled:opacity-60" pendingLabel="불러오는 중…" type="submit">보기</SubmitButton>
            </form>
            <Link aria-label="다음 달" className="grid h-[34px] w-[34px] place-items-center border border-finance-hairline bg-white text-finance-ink hover:bg-finance-panel" href={`/assets?month=${data.nextMonth}`}>→</Link>
          </div>
        </div>

        {saved && (
          <p className="mt-5 border-l-2 border-finance-green bg-finance-green-tint px-4 py-3 text-[13px] text-finance-green">
            {data.month} 자산 잔액을 저장했습니다.
          </p>
        )}

        <section className="mt-6 grid border-y border-finance-ink sm:grid-cols-2 sm:divide-x sm:divide-finance-hairline xl:grid-cols-4">
          <SummaryCard label="총자산" tone="asset" value={`${formatWon(data.overview.assets)}원`} description="부채를 제외한 보유 자산" />
          <SummaryCard label="부채" tone="debt" value={`${formatWon(data.overview.debt)}원`} description="대출 잔액 합계" />
          <SummaryCard label="순자산" tone="good" value={`${formatWon(data.overview.netWorth)}원`} description={deltaLabel} />
          <SummaryCard label="이번 달 입력" value={`${data.overview.enteredCount}/${data.overview.rows.length}개`} description="나머지는 직전 잔액 유지" />
        </section>

        <section className="mt-6 grid border-y border-finance-hairline sm:grid-cols-3 sm:divide-x sm:divide-finance-hairline">
          <article className="px-4 py-5 first:pl-0 sm:px-6">
            <p className="text-sm font-medium text-zinc-500">현금성·투자 자산</p>
            <p className="mt-2 text-xl font-semibold text-zinc-950">{formatWon(data.overview.liquidAssets)}원</p>
            <p className="mt-2 text-xs text-zinc-500">현금 + 저축·투자</p>
          </article>
          <article className="px-4 py-5 sm:px-6">
            <p className="text-sm font-medium text-zinc-500">비상금 여력</p>
            <p className="mt-2 text-xl font-semibold text-zinc-950">{data.emergencyMonths === null ? '-' : `${formatRate(data.emergencyMonths)}개월`}</p>
            <p className="mt-2 text-xs text-zinc-500">최근 최대 6개월 평균 지출 기준</p>
          </article>
          <article className="px-4 py-5 last:pr-0 sm:px-6">
            <p className="text-sm font-medium text-zinc-500">부채비율</p>
            <p className={`mt-2 text-xl font-semibold ${data.debtRatio !== null && data.debtRatio > 50 ? 'text-rose-700' : 'text-zinc-950'}`}>{data.debtRatio === null ? '-' : `${formatRate(data.debtRatio)}%`}</p>
            <p className="mt-2 text-xs text-zinc-500">총자산 대비 부채</p>
          </article>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
          <article className="overflow-hidden border-t border-finance-ink pt-4">
            <h2 className="text-sm font-bold text-finance-ink">{data.year}년 순자산 추이</h2>
            <p className="mt-1 text-xs text-finance-muted">미입력 월은 직전 잔액을 이어서 계산합니다.</p>
            <div className="mt-5 overflow-x-auto"><NetWorthChart data={data.trend} /></div>
          </article>
          <article className="border-t border-finance-ink pt-4">
            <h2 className="text-sm font-bold text-finance-ink">자산 배분</h2>
            <p className="mt-1 text-xs text-finance-muted">{data.month} 그룹별 비중</p>
            <div className="mt-5 space-y-4">
              {data.composition.map((item) => (
                <div key={item.major}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-zinc-700">{item.major}</span>
                    <span className="font-medium text-zinc-950">{formatWon(item.amount)}원</span>
                  </div>
                  <div className="mt-2 h-[5px] overflow-hidden bg-finance-track">
                    <div className="h-full bg-finance-blue" style={{ width: `${(item.amount / maxComposition) * 100}%` }} />
                  </div>
                </div>
              ))}
              {data.composition.length === 0 && <p className="py-12 text-center text-sm text-zinc-500">입력된 자산이 없습니다.</p>}
            </div>
          </article>
        </section>

        <AssetForm groups={data.overview.groups} month={data.month} />
      </main>
    </div>
  )
}
