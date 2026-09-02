import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SubmitButton } from '@/components/submit-button'
import { DeleteTransactionButton } from '@/features/ledger/delete-transaction-button'
import {
  getLedgerData,
  getLedgerFormOptions,
  getTransactionForEdit,
} from '@/features/ledger/queries'
import { TransactionForm } from '@/features/ledger/transaction-form'
import { currentMonthInKorea, formatRate, formatWon } from '@/lib/finance'
import { getAuthContext, requireHousehold } from '@/lib/household'

type LedgerPageProps = {
  searchParams: Promise<{
    edit?: string | string[]
    month?: string | string[]
    recurringAdded?: string | string[]
    recurringSkipped?: string | string[]
  }>
}

const flowLabel = {
  income: '수입',
  expense: '지출',
  saving: '저축',
} as const

const flowStyle = {
  income: 'bg-blue-50 text-blue-700',
  expense: 'bg-rose-50 text-rose-700',
  saving: 'bg-emerald-50 text-emerald-700',
} as const

function SummaryCard({
  label,
  value,
  tone,
  description,
}: {
  label: string
  value: string
  tone: 'neutral' | 'income' | 'expense' | 'saving'
  description?: string
}) {
  const toneClass = {
    neutral: 'text-zinc-950',
    income: 'text-blue-700',
    expense: 'text-rose-700',
    saving: 'text-emerald-700',
  }[tone]

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
      {description && <p className="mt-2 text-xs text-zinc-500">{description}</p>}
    </article>
  )
}

export default async function LedgerPage({ searchParams }: LedgerPageProps) {
  const auth = await getAuthContext()
  if (!auth) redirect('/login')

  const household = await requireHousehold()
  if (!household) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <AppHeader active="ledger" email={auth.email} />
        <main className="mx-auto max-w-3xl px-6 py-16">
          <section className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-semibold text-zinc-950">가구에 연결되지 않았습니다</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              관리자에게 이 이메일 계정을 가족 가계부에 연결해 달라고 요청해 주세요.
            </p>
          </section>
        </main>
      </div>
    )
  }

  const params = await searchParams
  const requestedMonth = typeof params.month === 'string' ? params.month : undefined
  const editId = typeof params.edit === 'string' ? Number(params.edit) : undefined
  const recurringAdded = typeof params.recurringAdded === 'string' ? Number(params.recurringAdded) : null
  const recurringSkipped = typeof params.recurringSkipped === 'string' ? Number(params.recurringSkipped) : null
  const [data, formOptions, editing] = await Promise.all([
    getLedgerData(household.householdId, requestedMonth),
    getLedgerFormOptions(household.householdId),
    getTransactionForEdit(household.householdId, editId),
  ])
  const maxCategoryAmount = data.topCategories[0]?.amount ?? 0
  const deltaIsUp = data.comparison.expenseDelta > 0
  const currentMonth = currentMonthInKorea()
  const defaultDate = data.month === currentMonth
    ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
    : `${data.month}-01`

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader active="ledger" email={auth.email} />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-emerald-700">월별 가계부</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">
              {data.month.replace('-', '년 ')}월
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              aria-label="이전 달"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50"
              href={`/ledger?month=${data.previousMonth}`}
            >
              ←
            </Link>
            <form action="/ledger" className="flex items-center gap-2">
              <input
                aria-label="조회 월"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800"
                defaultValue={data.month}
                max={data.latestMonth}
                name="month"
                type="month"
              />
              <SubmitButton
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
                pendingLabel="불러오는 중…"
                type="submit"
              >
                보기
              </SubmitButton>
            </form>
            <Link
              aria-label="다음 달"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50"
              href={`/ledger?month=${data.nextMonth}`}
            >
              →
            </Link>
          </div>
        </div>

        {recurringAdded !== null && Number.isInteger(recurringAdded) && (
          <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            정기거래 {recurringAdded}건을 추가했습니다.
            {recurringSkipped !== null && recurringSkipped > 0 ? ` 이미 반영된 ${recurringSkipped}건은 건너뛰었습니다.` : ''}
          </p>
        )}

        <div className="mt-6 flex gap-2 overflow-x-auto pb-2">
          {data.availableMonths.map((item) => (
            <Link
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                item.month === data.month
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400'
              }`}
              href={`/ledger?month=${item.month}`}
              key={item.month}
            >
              {item.month} · {item.count}건
            </Link>
          ))}
        </div>

        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="수입" tone="income" value={`${formatWon(data.totals.income)}원`} />
          <SummaryCard label="지출" tone="expense" value={`${formatWon(data.totals.expense)}원`} />
          <SummaryCard
            description={`순저축 ${formatWon(data.totals.netSaving)}원`}
            label="순저축률"
            tone="saving"
            value={`${formatRate(data.totals.savingsRate)}%`}
          />
          <SummaryCard
            description="적금·투자 납입액 · 순저축률과 별도"
            label="저축 납입"
            tone="neutral"
            value={`${formatWon(data.totals.saving)}원`}
          />
        </section>

        <TransactionForm
          accounts={formOptions.accounts}
          categories={formOptions.categories}
          defaultDate={defaultDate}
          editing={editing}
          month={data.month}
        />

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.42fr)]">
          <article className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-zinc-950">거래 내역</h2>
                <p className="mt-1 text-xs text-zinc-500">{data.transactions.length}건</p>
              </div>
              <span className="text-xs text-zinc-400">최근순</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">날짜</th>
                    <th className="px-3 py-3 font-medium">구분</th>
                    <th className="px-3 py-3 font-medium">분류</th>
                    <th className="px-3 py-3 font-medium">사용내역</th>
                    <th className="px-3 py-3 text-right font-medium">금액</th>
                    <th className="px-5 py-3 font-medium">결제수단</th>
                    <th className="px-5 py-3 text-right font-medium">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.transactions.map((transaction) => (
                    <tr className="hover:bg-zinc-50" key={transaction.id}>
                      <td className="whitespace-nowrap px-5 py-3 text-zinc-500">
                        {transaction.date.slice(5)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${flowStyle[transaction.flow]}`}
                        >
                          {transaction.flow === 'expense' && transaction.fixed
                            ? '고정지출'
                            : flowLabel[transaction.flow]}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-zinc-700">
                        <span>{transaction.major ?? '미분류'}</span>
                        {transaction.sub && <span className="text-zinc-400"> · {transaction.sub}</span>}
                      </td>
                      <td className="max-w-64 truncate px-3 py-3 text-zinc-700">
                        {transaction.memo || transaction.rawMerchant || '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-medium text-zinc-950">
                        {formatWon(transaction.amount)}원
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-zinc-500">
                        {transaction.account ?? '-'}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-3">
                          <Link
                            className="text-xs text-zinc-500 hover:text-zinc-950"
                            href={`/ledger?month=${data.month}&edit=${transaction.id}`}
                          >
                            수정
                          </Link>
                          <DeleteTransactionButton id={transaction.id} month={data.month} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.transactions.length === 0 && (
                    <tr>
                      <td className="px-5 py-12 text-center text-zinc-500" colSpan={7}>
                        이 달의 거래가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <aside className="space-y-6">
            <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">전월 대비 지출</p>
              <p
                className={`mt-2 text-2xl font-semibold ${deltaIsUp ? 'text-rose-700' : 'text-emerald-700'}`}
              >
                {data.comparison.expenseDelta === 0
                  ? '변동 없음'
                  : `${deltaIsUp ? '+' : '−'}${formatWon(Math.abs(data.comparison.expenseDelta))}원`}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                {data.previousMonth} 지출 {formatWon(data.comparison.previousExpense)}원
                {data.comparison.expenseDeltaRate !== null && (
                  <>
                    {' '}
                    · {deltaIsUp ? '+' : ''}
                    {formatRate(data.comparison.expenseDeltaRate)}%
                  </>
                )}
              </p>
            </article>

            <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-zinc-950">어디서 많이 썼나</h2>
                <span className="text-xs text-zinc-400">지출 대분류</span>
              </div>
              <div className="mt-5 space-y-4">
                {data.topCategories.slice(0, 8).map((category, index) => (
                  <div key={category.major}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-zinc-700">
                        {index + 1}. {category.major}
                      </span>
                      <span className="shrink-0 font-medium text-zinc-950">
                        {formatWon(category.amount)}원
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full rounded-full bg-emerald-600"
                        style={{
                          width: `${maxCategoryAmount > 0 ? (category.amount / maxCategoryAmount) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                {data.topCategories.length === 0 && (
                  <p className="text-sm text-zinc-500">이 달의 지출이 없습니다.</p>
                )}
              </div>
            </article>
          </aside>
        </section>
      </main>
    </div>
  )
}
