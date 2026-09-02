import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { BudgetForm } from '@/features/budgets/budget-form'
import { getBudgetData } from '@/features/budgets/queries'
import { formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'
import { createServerSupabase } from '@/lib/supabase/server'

type BudgetsPageProps = {
  searchParams: Promise<{ month?: string | string[]; reviewSaved?: string | string[] }>
}

function SummaryCard({ label, value, tone = 'default' }: {
  label: string
  value: string
  tone?: 'default' | 'good' | 'warning'
}) {
  const color = tone === 'good'
    ? 'text-emerald-700'
    : tone === 'warning'
      ? 'text-rose-700'
      : 'text-zinc-950'
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${color}`}>{value}</p>
    </article>
  )
}

export default async function BudgetsPage({ searchParams }: BudgetsPageProps) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login')

  const household = await requireHousehold()
  if (!household) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <AppHeader active="budgets" email={user.email} />
        <main className="mx-auto max-w-3xl px-6 py-16">
          <section className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-semibold text-zinc-950">가구에 연결되지 않았습니다</h1>
          </section>
        </main>
      </div>
    )
  }

  const params = await searchParams
  const requestedMonth = typeof params.month === 'string' ? params.month : undefined
  const reviewSaved = params.reviewSaved === '1'
  const data = await getBudgetData(household.householdId, requestedMonth)
  const remainingTone = data.totalBudget > 0 && data.remaining < 0 ? 'warning' : 'good'

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader active="budgets" email={user.email} />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-emerald-700">월별 계획</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">
              {data.month.replace('-', '년 ')}월 예산
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              className="whitespace-nowrap rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
              href={`/budgets/review?month=${data.nextMonth}`}
            >
              월말 리뷰 →
            </Link>
            <Link
              aria-label="이전 달"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50"
              href={`/budgets?month=${data.previousMonth}`}
            >
              ←
            </Link>
            <form action="/budgets" className="flex items-center gap-2">
              <input
                aria-label="예산 월"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800"
                defaultValue={data.month}
                name="month"
                type="month"
              />
              <button
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
                type="submit"
              >
                보기
              </button>
            </form>
            <Link
              aria-label="다음 달"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50"
              href={`/budgets?month=${data.nextMonth}`}
            >
              →
            </Link>
          </div>
        </div>

        {reviewSaved && <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">월말 리뷰에서 {data.month} 예산을 저장했습니다.</p>}

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <SummaryCard label="총 예산" value={`${formatWon(data.totalBudget)}원`} />
          <SummaryCard
            label="이번 달 사용"
            tone={data.totalBudget > 0 && data.totalActual > data.totalBudget ? 'warning' : 'default'}
            value={`${formatWon(data.totalActual)}원`}
          />
          <SummaryCard
            label={data.remaining < 0 ? '예산 초과' : '남은 예산'}
            tone={remainingTone}
            value={`${formatWon(Math.abs(data.remaining))}원`}
          />
        </section>

        <BudgetForm
          averageExpense={data.averageExpense}
          averageIncome={data.averageIncome}
          currentSavingsRate={data.currentSavingsRate}
          month={data.month}
          rows={data.rows}
          savingsTarget={data.savingsTarget}
        />
      </main>
    </div>
  )
}
