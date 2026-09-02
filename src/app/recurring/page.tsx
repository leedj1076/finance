import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { applyRecurringMonth } from '@/features/recurring/actions'
import { RecurringManager } from '@/features/recurring/recurring-manager'
import { getRecurringData } from '@/features/recurring/queries'
import { formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'
import { createServerSupabase } from '@/lib/supabase/server'

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
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${color}`}>{value}</p>
    </article>
  )
}

export default async function RecurringPage({ searchParams }: RecurringPageProps) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login')
  const household = await requireHousehold()
  if (!household) redirect('/')

  const params = await searchParams
  const requestedMonth = typeof params.month === 'string' ? params.month : undefined
  const data = await getRecurringData(household.householdId, requestedMonth)
  const saved = params.saved === '1'
  const monthError = params.error === 'month'

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader active="recurring" email={user.email} />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div>
          <p className="text-sm font-medium text-emerald-700">자동 입력</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">정기거래</h1>
          <p className="mt-2 text-sm text-zinc-500">매월 반복되는 수입·지출·저축을 한 번에 가계부에 반영합니다.</p>
        </div>

        {saved && <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">정기거래 규칙을 저장했습니다.</p>}
        {monthError && <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">반영할 월을 확인해 주세요.</p>}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="사용 중인 규칙" value={`${data.activeCount}개`} />
          <SummaryCard label="월 정기지출" tone="expense" value={`${formatWon(data.totals.expense)}원`} />
          <SummaryCard label="월 정기수입" tone="income" value={`${formatWon(data.totals.income)}원`} />
          <SummaryCard label="월 저축 납입" tone="saving" value={`${formatWon(data.totals.saving)}원`} />
        </section>

        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div>
              <h2 className="font-semibold text-zinc-950">선택한 달에 반영</h2>
              <p className="mt-1 text-xs text-zinc-500">
                {data.month} 기준 {data.generatedCount}/{data.activeCount}개 반영됨 · 같은 달에 다시 실행해도 중복되지 않습니다.
              </p>
            </div>
            <form action={applyRecurringMonth} className="flex items-center gap-2">
              <input aria-label="정기거래 적용 월" className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-800" defaultValue={data.month} name="month" type="month" />
              <button className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700" type="submit">선택한 달에 반영</button>
            </form>
          </div>
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">
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
