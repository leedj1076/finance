import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SubmitButton } from '@/components/submit-button'
import { getFinancialHealthData } from '@/features/analytics/financial-health'
import { AssetForm } from '@/features/assets/asset-form'
import { NetWorthChart } from '@/features/assets/net-worth-chart'
import { getAssetData } from '@/features/assets/queries'
import { formatWon } from '@/lib/finance'
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
    ? 'text-finance-blue'
    : tone === 'debt'
      ? 'text-finance-red'
      : tone === 'good'
        ? 'text-finance-green'
        : 'text-finance-ink'
  return (
    <article className="px-4 py-5 first:pl-0 last:pr-0 sm:px-6">
      <p className="t-label uppercase text-finance-muted">{label}</p>
      <p className={`mt-2 t-kpi tabular-nums ${color}`}>{value}</p>
      {description && <p className="mt-2 t-caption text-finance-muted">{description}</p>}
    </article>
  )
}

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const params = await searchParams
  const requestedMonth = typeof params.month === 'string' ? params.month : undefined
  const saved = params.saved === '1'
  const [data, financialHealth] = await Promise.all([
    getAssetData(household.householdId, requestedMonth),
    getFinancialHealthData(household.householdId),
  ])
  const deltaLabel = data.netWorthDelta === 0
    ? '전월과 동일'
    : `전월보다 ${formatWon(Math.abs(data.netWorthDelta))}원 ${data.netWorthDelta > 0 ? '증가' : '감소'}`
  const maxComposition = data.composition[0]?.amount ?? 1

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="assets" email={household.email} />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-14 pt-10 sm:px-12">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="t-label uppercase text-finance-blue">재무 상태</p>
            <h1 className="mt-2 t-page-title text-finance-ink">자산</h1>
            <p className="mt-2 t-caption text-finance-muted">{data.month} · 순자산 = 총자산 − 부채</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="h-[34px] border border-finance-hairline px-3 py-2 t-body-strong text-finance-muted hover:text-finance-blue" href="/settings?section=assets">자산 계정 설정</Link>
            <Link aria-label="이전 달" className="grid h-[34px] w-[34px] place-items-center border border-finance-hairline bg-white text-finance-ink hover:bg-finance-panel" href={`/assets?month=${data.previousMonth}`}>←</Link>
            <form action="/assets" className="flex items-center gap-2">
              <input aria-label="자산 기준 월" className="h-[34px] border border-finance-hairline bg-white px-3 t-body text-finance-ink" defaultValue={data.month} name="month" type="month" />
              <SubmitButton className="h-[34px] bg-finance-ink px-3 t-body-strong text-white hover:opacity-80 disabled:opacity-60" pendingLabel="불러오는 중…" type="submit">보기</SubmitButton>
            </form>
            <Link aria-label="다음 달" className="grid h-[34px] w-[34px] place-items-center border border-finance-hairline bg-white text-finance-ink hover:bg-finance-panel" href={`/assets?month=${data.nextMonth}`}>→</Link>
          </div>
        </div>

        {saved && (
          <p className="mt-5 border-l-2 border-finance-green bg-finance-green-tint px-4 py-3 t-body text-finance-green">
            {data.month} 자산 잔액을 저장했습니다.
          </p>
        )}

        <section className="mt-6 grid border-y border-finance-ink sm:grid-cols-2 sm:divide-x sm:divide-finance-hairline xl:grid-cols-4">
          <SummaryCard label="총자산" tone="asset" value={`${formatWon(data.overview.assets)}원`} description={`현금성·투자 ${formatWon(data.overview.liquidAssets)}원`} />
          <SummaryCard label="부채" tone="debt" value={`${formatWon(data.overview.debt)}원`} description="대출 잔액 합계" />
          <SummaryCard label="순자산" tone="good" value={`${formatWon(data.overview.netWorth)}원`} description={deltaLabel} />
          <SummaryCard label="이번 달 입력" value={`${data.overview.enteredCount}/${data.overview.rows.length}개`} description="나머지는 직전 잔액 유지" />
        </section>

        <section className="mt-6 grid gap-6 border-y border-finance-hairline py-5 sm:grid-cols-2 xl:grid-cols-4">
          {financialHealth.map((item) => {
            const tone = {
              good: 'border-finance-green',
              ok: 'border-finance-amber',
              warn: 'border-finance-red',
              none: 'border-finance-faint',
            }[item.status]
            return (
              <article className={`border-l-2 pl-4 ${tone}`} key={item.key}>
                <p className="t-label text-finance-muted">{item.key}</p>
                <p className="mt-1.5 t-kpi-sm text-finance-ink">{item.value}</p>
                <p className="mt-1 t-caption text-finance-faint">{item.hint}</p>
              </article>
            )
          })}
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
          <article className="overflow-hidden border-t border-finance-ink pt-4">
            <h2 className="t-section text-finance-ink">{data.year}년 순자산 추이</h2>
            <p className="mt-1 t-caption text-finance-muted">미입력 월은 직전 잔액을 이어서 계산합니다.</p>
            <div className="mt-5 overflow-x-auto"><NetWorthChart data={data.trend} /></div>
          </article>
          <article className="border-t border-finance-ink pt-4">
            <h2 className="t-section text-finance-ink">자산 배분</h2>
            <p className="mt-1 t-caption text-finance-muted">{data.month} 그룹별 비중</p>
            <div className="mt-5 space-y-4">
              {data.composition.map((item) => (
                <div key={item.major}>
                  <div className="flex items-center justify-between gap-3 t-body">
                    <span className="text-finance-ink">{item.major}</span>
                    <span className="font-medium text-finance-ink">{formatWon(item.amount)}원</span>
                  </div>
                  <div className="mt-2 h-[5px] overflow-hidden bg-finance-track">
                    <div className="h-full bg-finance-blue" style={{ width: `${(item.amount / maxComposition) * 100}%` }} />
                  </div>
                </div>
              ))}
              {data.composition.length === 0 && <p className="py-12 text-center t-body text-finance-muted">입력된 자산이 없습니다.</p>}
            </div>
          </article>
        </section>

        <details className="group mt-6 border-t border-finance-ink" id="balance-adjustment">
          <summary className="flex cursor-pointer list-none items-center justify-between py-4 t-section text-finance-ink">
            <span>잔고 보정 <span className="ml-2 font-normal text-finance-muted">자동 스냅샷에 없는 계정이나 잔액만 직접 고칩니다</span></span>
            <span className="text-finance-muted group-open:rotate-180" aria-hidden="true">⌄</span>
          </summary>
          <AssetForm balanceOnly groups={data.overview.groups} month={data.month} />
        </details>
      </main>
    </div>
  )
}
