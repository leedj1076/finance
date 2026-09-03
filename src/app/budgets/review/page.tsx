import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { BudgetReviewForm } from '@/features/budgets/budget-review-form'
import { getBudgetReviewData } from '@/features/budgets/review-queries'
import { formatRate, formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type BudgetReviewPageProps = { searchParams: Promise<{ month?: string | string[] }> }

function SummaryCard({ label, value, description, tone = 'default' }: { label: string; value: string; description?: string; tone?: 'default' | 'income' | 'expense' | 'saving' }) {
  const color = tone === 'income' ? 'text-blue-700' : tone === 'expense' ? 'text-rose-700' : tone === 'saving' ? 'text-emerald-700' : 'text-zinc-950'
  return <article className="px-4 py-5 first:pl-0 last:pr-0 sm:px-6"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-finance-muted">{label}</p><p className={`mt-2 text-[26px] font-semibold leading-none tabular-nums ${color}`}>{value}</p>{description && <p className="mt-2 text-xs text-finance-muted">{description}</p>}</article>
}

export default async function BudgetReviewPage({ searchParams }: BudgetReviewPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const params = await searchParams
  const requestedMonth = typeof params.month === 'string' ? params.month : undefined
  const data = await getBudgetReviewData(household.householdId, requestedMonth)

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="budgets" email={household.email} />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-14 pt-10 sm:px-12">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">월말 계획</p><h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">월말 리뷰</h1><p className="mt-2 text-xs text-finance-muted">{data.reviewMonth} 결산 → {data.targetMonth} 예산 만들기</p></div>
          <Link className="inline-flex h-[34px] items-center border border-finance-hairline bg-white px-4 text-xs font-semibold text-finance-ink hover:bg-finance-panel" href={`/budgets?month=${data.targetMonth}`}>예산으로 돌아가기</Link>
        </div>

        {data.existingCount > 0 && <p className="mt-5 border-l-2 border-finance-blue bg-finance-blue-tint px-4 py-3 text-[13px] text-finance-blue">{data.targetMonth}에 이미 저장된 예산 {data.existingCount}개를 우선 불러왔습니다. 다시 저장해도 중복되지 않습니다.</p>}

        <section className="mt-6 grid border-y border-finance-ink sm:grid-cols-2 sm:divide-x sm:divide-finance-hairline xl:grid-cols-4">
          <SummaryCard label={`${data.reviewMonth} 수입`} tone="income" value={`${formatWon(data.reviewIncome)}원`} />
          <SummaryCard label={`${data.reviewMonth} 지출`} tone="expense" value={`${formatWon(data.reviewExpense)}원`} />
          <SummaryCard description={`순저축 ${formatWon(data.reviewIncome - data.reviewExpense)}원`} label="지난달 순저축률" tone="saving" value={`${formatRate(data.reviewSavingsRate)}%`} />
          <SummaryCard description={`실제 ${formatWon(data.reviewExpense)}원`} label="지난달 예산 합계" value={`${formatWon(data.reviewBudgetTotal)}원`} />
        </section>

        {data.reviewIncome === 0 && data.reviewExpense === 0 && <p className="mt-5 border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 text-[13px] text-finance-amber">{data.reviewMonth} 거래가 아직 없습니다. 이전 기록의 중앙값과 기존 예산을 기준으로 제안합니다.</p>}

        <BudgetReviewForm averageIncome={data.averageIncome} rows={data.rows} savingsTarget={data.savingsTarget} spendCeiling={data.spendCeiling} targetMonth={data.targetMonth} />
      </main>
    </div>
  )
}
