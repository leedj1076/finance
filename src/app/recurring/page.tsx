import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SettingsNav } from '@/components/settings-nav'
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
    ? 'text-finance-red'
    : tone === 'income'
      ? 'text-finance-blue'
      : tone === 'saving'
        ? 'text-finance-green'
        : 'text-finance-ink'
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

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="settings" email={household.email} />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-14 pt-10 sm:px-12">
        <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
          <SettingsNav active="recurring" />
          <div className="min-w-0">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">자동 입력</p>
          <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">정기거래 규칙</h1>
          <p className="mt-2 t-caption text-finance-muted">매월 반복되는 수입·지출·저축의 규칙을 관리합니다. 월 반영은 내역 화면에서 실행합니다.</p>
        </div>

        {saved && <p className="mt-5 border-l-2 border-finance-green bg-finance-green-tint px-4 py-3 text-[13px] text-finance-green">정기거래 규칙을 저장했습니다.</p>}

        <section className="mt-6 grid border-y border-finance-ink sm:grid-cols-2 sm:divide-x sm:divide-finance-hairline xl:grid-cols-4">
          <SummaryCard label="사용 중인 규칙" value={`${data.activeCount}개`} />
          <SummaryCard label="월 정기지출" tone="expense" value={`${formatWon(data.totals.expense)}원`} />
          <SummaryCard label="월 정기수입" tone="income" value={`${formatWon(data.totals.income)}원`} />
          <SummaryCard label="월 저축 납입" tone="saving" value={`${formatWon(data.totals.saving)}원`} />
        </section>

        <p className="mt-5 border-l-2 border-finance-blue bg-finance-blue-tint px-3 py-3 t-caption text-finance-blue">
          {data.month} 기준 {data.generatedCount}/{data.activeCount}개가 반영되었습니다. <Link className="font-semibold underline underline-offset-2" href={`/ledger?month=${data.month}&tab=list`}>내역에서 반영 상태 확인 →</Link>
        </p>

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
          </div>
        </div>
      </main>
    </div>
  )
}
