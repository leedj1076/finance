'use client'

import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { formatRate, formatWon } from '@/lib/finance'

import { saveBudgetPlan, type BudgetActionState } from './actions'
import { VariableSpendSimulator } from './simulator'

type BudgetRow = {
  major: string
  group: string
  budget: number
  previousBudget: number
  actual: number
  average: number
  remaining: number
  percent: number | null
}

type BudgetFormProps = {
  averageExpense: number
  averageIncome: number
  currentSavingsRate: number
  month: string
  rows: BudgetRow[]
  savingsTarget: number
}

const groups = [
  { key: 'fixed', label: '고정비', note: '조절이 어려운 비용' },
  { key: 'variable', label: '변동비', note: '생활하면서 조절할 비용' },
  { key: 'irregular', label: '비정기', note: '여행·경조사 등 월 적립 예산' },
]

const initialState: BudgetActionState = {}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <button
      className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? '저장 중…' : '이달 예산 저장'}
    </button>
  )
}

export function BudgetForm({
  averageExpense,
  averageIncome,
  currentSavingsRate,
  month,
  rows,
  savingsTarget,
}: BudgetFormProps) {
  const [state, action] = useActionState(saveBudgetPlan, initialState)
  const [target, setTarget] = useState(savingsTarget)
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.major, String(row.budget || '')])),
  )
  const totalBudget = useMemo(
    () => Object.values(amounts).reduce((sum, value) => sum + (Number(value) || 0), 0),
    [amounts],
  )
  const spendCeiling = Math.round(averageIncome * (1 - target / 100))
  const targetGap = Math.max(averageExpense - spendCeiling, 0)

  function fillFrom(key: 'average' | 'previousBudget') {
    setAmounts(Object.fromEntries(rows.map((row) => [row.major, String(row[key] || '')])))
  }

  function applySimulator(amountsFromCuts: Record<string, string>) {
    setAmounts((current) => ({ ...current, ...amountsFromCuts }))
    document.getElementById('budget-list')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <form action={action} className="mt-6 space-y-6">
      <input name="month" type="hidden" value={month} />

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="min-w-64">
            <label className="text-sm font-medium text-zinc-700" htmlFor="savings-target">
              목표 저축률
            </label>
            <div className="mt-3 flex items-center gap-4">
              <input
                aria-label="목표 저축률"
                className="w-full accent-emerald-700"
                id="savings-target"
                max={80}
                min={0}
                name="savingsTarget"
                onChange={(event) => setTarget(Number(event.target.value))}
                type="range"
                value={target}
              />
              <output className="w-14 text-right text-xl font-semibold text-emerald-700">
                {target}%
              </output>
            </div>
          </div>
          <div className="grid flex-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-zinc-50 p-4">
              <p className="text-xs text-zinc-500">월평균 수입</p>
              <p className="mt-1 font-semibold text-zinc-950">{formatWon(averageIncome)}원</p>
            </div>
            <div className="rounded-xl bg-zinc-50 p-4">
              <p className="text-xs text-zinc-500">현재 순저축률</p>
              <p className="mt-1 font-semibold text-zinc-950">{formatRate(currentSavingsRate)}%</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-xs text-emerald-700">목표 지출 상한</p>
              <p className="mt-1 font-semibold text-emerald-800">{formatWon(spendCeiling)}원</p>
            </div>
          </div>
        </div>
        <p className={`mt-4 text-sm ${targetGap > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
          {targetGap > 0
            ? `목표 달성을 위해 월평균 지출에서 ${formatWon(targetGap)}원을 줄여야 합니다.`
            : '현재 월평균 지출이 목표 상한 이내입니다.'}
        </p>
      </section>

      <VariableSpendSimulator
        averageExpense={averageExpense}
        averageIncome={averageIncome}
        onApply={applySimulator}
        rows={rows
          .filter((row) => row.group === 'variable' && row.average > 0)
          .sort((left, right) => right.average - left.average)
          .map((row) => ({ major: row.major, average: row.average }))}
        savingsTarget={target}
      />

      <section
        className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
        id="budget-list"
      >
        <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-semibold text-zinc-950">분류별 월 예산</h2>
            <p className="mt-1 text-xs text-zinc-500">입력 합계 {formatWon(totalBudget)}원</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => fillFrom('previousBudget')}
              type="button"
            >
              지난달 예산 채우기
            </button>
            <button
              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => fillFrom('average')}
              type="button"
            >
              월평균으로 채우기
            </button>
            <SaveButton />
          </div>
        </div>

        <div className="divide-y divide-zinc-200">
          {groups.map((group) => {
            const groupRows = rows.filter((row) => row.group === group.key)
            if (groupRows.length === 0) return null
            return (
              <section className="p-5" key={group.key}>
                <div className="mb-4 flex items-baseline gap-2">
                  <h3 className="font-semibold text-zinc-900">{group.label}</h3>
                  <span className="text-xs text-zinc-400">{group.note}</span>
                </div>
                <div className="space-y-3">
                  {groupRows.map((row) => {
                    const currentBudget = Number(amounts[row.major]) || 0
                    const percent = currentBudget > 0 ? (row.actual / currentBudget) * 100 : null
                    return (
                      <div
                        className="grid items-center gap-3 rounded-xl bg-zinc-50 p-3 md:grid-cols-[minmax(120px,1fr)_150px_130px_minmax(140px,0.8fr)]"
                        key={row.major}
                      >
                        <div>
                          <p className="text-sm font-medium text-zinc-800">{row.major}</p>
                          <p className="mt-1 text-xs text-zinc-400">평균 {formatWon(row.average)}원</p>
                        </div>
                        <label className="text-xs text-zinc-500">
                          <span className="sr-only">{row.major} 예산</span>
                          <input
                            aria-label={`${row.major} 예산`}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-right text-sm text-zinc-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                            min={0}
                            name={`budget:${row.major}`}
                            onChange={(event) =>
                              setAmounts((current) => ({
                                ...current,
                                [row.major]: event.target.value,
                              }))
                            }
                            placeholder="0"
                            step={10000}
                            type="number"
                            value={amounts[row.major]}
                          />
                        </label>
                        <div className="text-right text-sm">
                          <p className="font-medium text-zinc-800">{formatWon(row.actual)}원 사용</p>
                          <p className={currentBudget - row.actual < 0 ? 'text-rose-600' : 'text-zinc-400'}>
                            {currentBudget > 0
                              ? `${formatWon(Math.abs(currentBudget - row.actual))}원 ${currentBudget - row.actual < 0 ? '초과' : '남음'}`
                              : '미설정'}
                          </p>
                        </div>
                        <div>
                          <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
                            <div
                              className={`h-full rounded-full ${percent !== null && percent > 100 ? 'bg-rose-600' : 'bg-emerald-600'}`}
                              style={{ width: `${Math.min(percent ?? 0, 100)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-right text-xs text-zinc-400">
                            {percent === null ? '-' : `${formatRate(percent)}%`}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </section>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  )
}
