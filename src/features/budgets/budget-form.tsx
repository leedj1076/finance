'use client'

import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { formatRate, formatWon, savingsRate } from '@/lib/finance'

import { saveBudgetPlan, type BudgetActionState } from './actions'
import { spendingCeilingForTarget } from './simulator-calculations'
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
  spendCeiling: number
}

const groups = [
  { key: 'fixed', label: '고정비', note: '조절이 어려운 비용' },
  { key: 'variable', label: '변동비', note: '생활하면서 조절할 비용' },
  { key: 'irregular', label: '비정기', note: '여행·경조사 등 월 적립 예산' },
]

const initialState: BudgetActionState = {}

function SaveButton({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      className={`h-[34px] px-4 t-body-strong transition-colors disabled:cursor-not-allowed ${dirty
        ? 'bg-finance-ink text-white hover:opacity-80 disabled:opacity-60'
        : 'border border-finance-hairline bg-finance-panel text-finance-muted'}`}
      disabled={pending || !dirty}
      type="submit"
    >
      {pending ? '저장 중…' : dirty ? '변경사항 저장' : '저장됨'}
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
  spendCeiling,
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
  const targetSpendCeiling = spendingCeilingForTarget({
    averageIncome,
    initialSavingsTarget: savingsTarget,
    savingsTarget: target,
    serverSpendCeiling: spendCeiling,
  })
  const targetGap = Math.max(averageExpense - targetSpendCeiling, 0)
  const allocationGap = targetSpendCeiling - totalBudget
  const expectedSavingsRate = savingsRate(averageIncome, totalBudget)
  const isDirty = target !== savingsTarget || rows.some(
    (row) => amounts[row.major] !== String(row.budget || ''),
  )

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

      <section className="border-y border-finance-ink py-5">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="t-label uppercase text-finance-blue">지출 상한 배분</p>
            <h2 className="mt-1 t-section text-finance-ink">저축 목표 안에서 카테고리 예산을 나눕니다</h2>
          </div>
          <p className={`t-body-strong tabular-nums ${allocationGap < 0 ? 'text-finance-red' : 'text-finance-green'}`} aria-live="polite">
            {allocationGap < 0
              ? `상한보다 ${formatWon(Math.abs(allocationGap))}원 초과`
              : `상한 안에서 ${formatWon(allocationGap)}원 여유`}
          </p>
        </div>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="min-w-64">
            <label className="t-body font-medium text-finance-ink" htmlFor="savings-target">
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
              <output className="w-14 text-right t-kpi-sm text-finance-green">
                {target}%
              </output>
            </div>
          </div>
          <div className="grid flex-1 border-y border-finance-hairline sm:grid-cols-4 sm:divide-x sm:divide-finance-hairline">
            <div className="p-4">
              <p className="t-caption text-finance-muted">월평균 수입</p>
              <p className="mt-1 t-kpi-sm text-finance-ink">{formatWon(averageIncome)}원</p>
            </div>
            <div className="p-4">
              <p className="t-caption text-finance-muted">카테고리 합계</p>
              <p className="mt-1 t-kpi-sm text-finance-ink">{formatWon(totalBudget)}원</p>
            </div>
            <div className="p-4">
              <p className="t-caption text-finance-green">목표 지출 상한</p>
              <p className="mt-1 t-kpi-sm text-finance-green">{formatWon(targetSpendCeiling)}원</p>
            </div>
            <div className="p-4">
              <p className="t-caption text-finance-muted">예상 순저축률</p>
              <p className={`mt-1 t-kpi-sm ${expectedSavingsRate >= target ? 'text-finance-green' : 'text-finance-red'}`}>
                {formatRate(expectedSavingsRate)}%
              </p>
              <p className="mt-1 t-caption text-finance-muted">현재 실적 {formatRate(currentSavingsRate)}%</p>
            </div>
          </div>
        </div>
        <p className={`mt-4 t-body ${targetGap > 0 ? 'text-finance-red' : 'text-finance-green'}`}>
          {targetGap > 0
            ? `목표 달성을 위해 월평균 지출에서 ${formatWon(targetGap)}원을 줄여야 합니다.`
            : '현재 월평균 지출이 목표 상한 이내입니다.'}
        </p>
      </section>

      <section
        className="overflow-hidden border-t border-finance-ink"
        id="budget-list"
      >
        <div className="flex flex-col justify-between gap-4 border-b border-finance-hairline py-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="t-section text-finance-ink">분류별 월 예산</h2>
            <p className="mt-1 t-caption text-finance-muted">입력 합계 {formatWon(totalBudget)}원</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="h-[30px] border border-finance-hairline px-3 t-body-strong text-finance-ink hover:bg-finance-panel"
              onClick={() => fillFrom('previousBudget')}
              type="button"
            >
              지난달 예산 채우기
            </button>
            <button
              className="h-[30px] border border-finance-hairline px-3 t-body-strong text-finance-ink hover:bg-finance-panel"
              onClick={() => fillFrom('average')}
              type="button"
            >
              월평균으로 채우기
            </button>
            <SaveButton dirty={isDirty} />
          </div>
        </div>

        <div className="divide-y divide-finance-hairline">
          {groups.map((group) => {
            const groupRows = rows.filter((row) => row.group === group.key)
            if (groupRows.length === 0) return null
            return (
              <section className="p-5" key={group.key}>
                <div className="mb-4 flex items-baseline gap-2">
                  <h3 className="t-section text-finance-ink">{group.label}</h3>
                  <span className="t-caption text-finance-faint">{group.note}</span>
                </div>
                <div className="space-y-3">
                  {groupRows.map((row) => {
                    const currentBudget = Number(amounts[row.major]) || 0
                    const percent = currentBudget > 0 ? (row.actual / currentBudget) * 100 : null
                    return (
                      <div
                        className="grid items-center gap-3 border-b border-finance-hairline py-3 md:grid-cols-[minmax(120px,1fr)_150px_130px_minmax(140px,0.8fr)]"
                        key={row.major}
                      >
                        <div>
                          <p className="t-body font-medium text-finance-ink">{row.major}</p>
                          <p className="mt-1 t-caption text-finance-faint">평균 {formatWon(row.average)}원</p>
                        </div>
                        <label className="t-caption text-finance-muted">
                          <span className="sr-only">{row.major} 예산</span>
                          <input
                            aria-label={`${row.major} 예산`}
                            className="h-[34px] w-full border border-finance-hairline bg-white px-3 text-right t-body tabular-nums text-finance-ink outline-none focus:border-finance-blue"
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
                        <div className="text-right t-body">
                          <p className="font-medium text-finance-ink">{formatWon(row.actual)}원 사용</p>
                          <p className={currentBudget - row.actual < 0 ? 'text-finance-red' : 'text-finance-faint'}>
                            {currentBudget > 0
                              ? `${formatWon(Math.abs(currentBudget - row.actual))}원 ${currentBudget - row.actual < 0 ? '초과' : '남음'}`
                              : '미설정'}
                          </p>
                        </div>
                        <div>
                          <div className="h-[5px] overflow-hidden bg-finance-track">
                            <div
                              className={`h-full ${percent !== null && percent > 100 ? 'bg-finance-red' : 'bg-finance-green'}`}
                              style={{ width: `${Math.min(percent ?? 0, 100)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-right t-caption text-finance-faint">
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

      <details className="group border-t border-finance-ink">
        <summary className="flex cursor-pointer list-none items-center justify-between py-4 t-section text-finance-ink">
          <span>절약 시뮬레이션 <span className="ml-2 font-normal text-finance-muted">변동비를 줄였을 때 목표 달성 여부를 미리 봅니다</span></span>
          <span className="text-finance-muted group-open:rotate-180" aria-hidden="true">⌄</span>
        </summary>
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
      </details>

      {state.error && <p className="t-body text-finance-red">{state.error}</p>}
    </form>
  )
}
