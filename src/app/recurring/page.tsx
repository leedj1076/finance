import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SubmitButton } from '@/components/submit-button'
import { applyRecurringMonth } from '@/features/recurring/actions'
import { RecurringManager } from '@/features/recurring/recurring-manager'
import { getRecurringData } from '@/features/recurring/queries'
import { formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type RecurringPageProps = {
  searchParams: Promise<{ month?: string | string[]; saved?: string | string[]; error?: string | string[] }>
}

function SummaryCard({ label, value, tone = 'default' }: {
  label: string
  value: string
  tone?: 'default' | 'expense' | 'income' | 'saving'
}) {
  const color = tone === 'expense'
    ? 'text-rose-700'
    : tone === 'income'
      ? 'text-blue-700'
      : tone === 'saving'
        ? 'text-emerald-700'
        : 'text-zinc-950'
  return (
    <article className="px-4 py-5 first:pl-0 last:pr-0 sm:px-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-finance-muted">{label}</p>
      <p className={`mt-2 text-[26px] font-semibold leading-none tabular-nums ${color}`}>{value}</p>
    </article>
  )
}

export default async function RecurringPage({ searchParams }: RecurringPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const params = await searchParams
  const requestedMonth = typeof params.month === 'string' ? params.month : undefined
  const data = await getRecurringData(household.householdId, requestedMonth)
  const saved = params.saved === '1'
  const monthError = params.error === 'month'

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="recurring" email={household.email} />
      <main className="mx-auto max-w-none px-5 pb-12 pt-10 sm:px-12">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">자동 입력</p>
          <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">정기거래</h1>
          <p className="mt-2 text-xs text-finance-muted">매월 반복되는 수입·지출·저축을 한 번에 가계부에 반영합니다.</p>
        </div>

        {saved && <p className="mt-5 border-l-2 border-finance-green bg-finance-green-tint px-4 py-3 text-[13px] text-finance-green">정기거래 규칙을 저장했습니다.</p>}
        {monthError && <p className="mt-5 border-l-2 border-finance-red bg-finance-red-tint px-4 py-3 text-[13px] text-finance-red">반영할 월을 확인해 주세요.</p>}

        <section className="mt-6 grid border-y border-finance-ink sm:grid-cols-2 sm:divide-x sm:divide-finance-hairline xl:grid-cols-4">
          <SummaryCard label="사용 중인 규칙" value={`${data.activeCount}개`} />
          <SummaryCard label="월 정기지출" tone="expense" value={`${formatWon(data.totals.expense)}원`} />
          <SummaryCard label="월 정기수입" tone="income" value={`${formatWon(data.totals.income)}원`} />
          <SummaryCard label="월 저축 납입" tone="saving" value={`${formatWon(data.totals.saving)}원`} />
        </section>

        <section className="mt-6 border-t border-finance-ink py-4">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div>
              <h2 className="text-sm font-bold text-finance-ink">선택한 달에 반영</h2>
              <p className="mt-1 text-xs text-finance-muted">
                {data.month} 기준 {data.generatedCount}/{data.activeCount}개 반영됨 · 같은 달에 다시 실행해도 중복되지 않습니다.
              </p>
            </div>
            <form action={applyRecurringMonth} className="flex items-center gap-2">
              <input aria-label="정기거래 적용 월" className="h-[34px] border border-finance-hairline bg-white px-3 text-[13px] text-finance-ink" defaultValue={data.month} name="month" type="month" />
              <SubmitButton className="h-[34px] bg-finance-ink px-4 text-[13px] font-semibold text-white hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60" pendingLabel="반영 중…" type="submit">선택한 달에 반영</SubmitButton>
            </form>
          </div>
          <p className="mt-4 border-l-2 border-finance-amber bg-finance-amber-tint px-3 py-3 text-xs leading-5 text-finance-amber">
            다른 경로로 이미 입력한 동일 거래까지 자동으로 판별하지는 않습니다. 새 달을 시작할 때 한 번 실행하는 방식이 가장 안전합니다.
          </p>
        </section>

        <RecurringManager
          accounts={data.accounts}
          candidates={data.candidates}
          categories={data.categories}
          initialRules={data.rules.map((rule) => ({
            key: `rule-${rule.id}`,
            id: rule.id,
            flowToken: rule.flowToken,
            categoryId: rule.categoryId,
            memo: rule.memo,
            amount: String(rule.amount),
            accountId: rule.accountId,
            day: rule.day,
            active: rule.active,
            generated: rule.generated,
          }))}
          month={data.month}
        />
      </main>
    </div>
  )
}
