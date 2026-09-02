'use client'

import { useMemo, useState } from 'react'

import { formatRate, formatWon } from '@/lib/finance'

import {
  budgetAmountsFromCuts,
  calculateVariableSpendSimulation,
  quickCutAmount,
  type VariableSpendRow,
} from './simulator-calculations'

type VariableSpendSimulatorProps = {
  averageExpense: number
  averageIncome: number
  onApply: (amounts: Record<string, string>) => void
  rows: VariableSpendRow[]
  savingsTarget: number
}

export function VariableSpendSimulator({
  averageExpense,
  averageIncome,
  onApply,
  rows,
  savingsTarget,
}: VariableSpendSimulatorProps) {
  const [cuts, setCuts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.major, '0'])),
  )
  const [applied, setApplied] = useState(false)
  const simulation = useMemo(
    () => calculateVariableSpendSimulation({
      averageExpense,
      averageIncome,
      cuts,
      savingsTarget,
    }),
    [averageExpense, averageIncome, cuts, savingsTarget],
  )

  function updateCut(major: string, value: string) {
    setCuts((current) => ({ ...current, [major]: value }))
    setApplied(false)
  }

  function applyToBudget() {
    onApply(budgetAmountsFromCuts(rows, cuts))
    setApplied(true)
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col justify-between gap-1 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
        <h2 className="font-semibold text-zinc-950">어디서 줄일까</h2>
        <p className="text-xs text-zinc-500">변동비 감축 시뮬레이터</p>
      </div>

      <div className="p-5">
        <div className="mb-5 rounded-xl bg-zinc-50 p-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <span className="text-zinc-500">예상 저축률</span>
            <strong className={simulation.savingsRate >= savingsTarget ? 'text-emerald-700' : 'text-rose-700'}>
              {formatRate(simulation.savingsRate)}%
            </strong>
            <span className="text-zinc-500">/ 목표 {savingsTarget}%</span>
            <span className={simulation.targetReached ? 'text-emerald-700' : 'text-rose-700'}>
              {simulation.targetReached
                ? '(목표 달성)'
                : `(목표까지 ${formatWon(simulation.targetGap)}원 추가 감축 필요)`}
            </span>
          </div>
          <div
            aria-label={`저축률 목표 달성도 ${formatRate(simulation.progressPercent)}%`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.max(0, simulation.progressPercent)}
            className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200"
            role="progressbar"
          >
            <div
              className={`h-full rounded-full transition-[width] ${simulation.savingsRate >= savingsTarget ? 'bg-emerald-600' : 'bg-blue-600'}`}
              style={{ width: `${Math.max(0, simulation.progressPercent)}%` }}
            />
          </div>
        </div>

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500">
                  <th className="px-2 py-2 text-left font-medium" scope="col">분류</th>
                  <th className="px-2 py-2 text-right font-medium" scope="col">월평균</th>
                  <th className="px-2 py-2 text-right font-medium" scope="col">감축액</th>
                  <th className="px-2 py-2 text-center font-medium" scope="col">빠른 선택</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.major}>
                    <th className="px-2 py-3 text-left font-medium text-zinc-800" scope="row">
                      {row.major}
                    </th>
                    <td className="px-2 py-3 text-right tabular-nums text-zinc-600">
                      {formatWon(row.average)}원
                    </td>
                    <td className="px-2 py-3 text-right">
                      <input
                        aria-label={`${row.major} 감축액`}
                        className="w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-right tabular-nums text-zinc-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                        min={0}
                        onChange={(event) => updateCut(row.major, event.target.value)}
                        step={10_000}
                        type="number"
                        value={cuts[row.major] ?? '0'}
                      />
                    </td>
                    <td className="px-2 py-3 text-center">
                      <div className="inline-flex gap-1">
                        {([10, 20] as const).map((percent) => (
                          <button
                            className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-800"
                            key={percent}
                            onClick={() => updateCut(row.major, String(quickCutAmount(row.average, percent)))}
                            type="button"
                          >
                            -{percent}%
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl bg-zinc-50 px-4 py-5 text-sm text-zinc-500">
            완료된 달의 변동비 지출이 쌓이면 감축안을 계산할 수 있습니다.
          </p>
        )}

        <div className="mt-5 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <button
            className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800"
            onClick={applyToBudget}
            type="button"
          >
            이 감축안을 이번 달 예산에 반영
          </button>
          {applied && (
            <p className="text-xs text-emerald-700" role="status">
              예산 입력칸에 반영했습니다. 실제 저장은 아래 저장 버튼을 눌러 완료해 주세요.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
