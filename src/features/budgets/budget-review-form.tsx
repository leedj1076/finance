'use client'

import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { formatRate, formatWon } from '@/lib/finance'

import { projectedSavingsRate, type ReviewGroup } from './review-calculations'
import { saveBudgetReview, type BudgetReviewActionState } from './review-actions'

type ReviewRow = {
  major: string
  group: ReviewGroup
  previousBudget: number
  previousActual: number
  difference: number
  median: number
  existing: number | null
  suggestion: number
}

type BudgetReviewFormProps = {
  averageIncome: number
  rows: ReviewRow[]
  savingsTarget: number
  spendCeiling: number
  targetMonth: string
}

const groupInfo: Record<ReviewGroup, { title: string; note: string; tone: string }> = {
  fixed: { title: '고정비', note: '지난달 예산을 우선 유지', tone: 'border-blue-200 bg-blue-50' },
  variable: { title: '변동비', note: '최근 6개월 중앙값으로 제안', tone: 'border-orange-200 bg-orange-50' },
  irregular: { title: '비정기', note: '기존 월 적립액을 우선 유지', tone: 'border-zinc-200 bg-zinc-100' },
}

const initialState: BudgetReviewActionState = {}

function SaveButton({ targetMonth }: { targetMonth: string }) {
  const { pending } = useFormStatus()
  return (
    <button className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60" disabled={pending} type="submit">
      {pending ? '저장 중…' : `${targetMonth} 예산으로 저장`}
    </button>
  )
}

export function BudgetReviewForm({ averageIncome, rows, savingsTarget, spendCeiling, targetMonth }: BudgetReviewFormProps) {
  const [state, action] = useActionState(saveBudgetReview, initialState)
  const [reduction, setReduction] = useState(10)
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.major, row.suggestion ? String(row.suggestion) : ''])),
  )
  const total = useMemo(
    () => Object.values(amounts).reduce((sum, value) => sum + (Number(value) || 0), 0),
    [amounts],
  )
  const ceilingGap = spendCeiling - total
  const projectedRate = projectedSavingsRate(averageIncome, total)

  function reduceVariableBudgets() {
    if (!Number.isFinite(reduction) || reduction < 0 || reduction > 50) return
    setAmounts((current) => Object.fromEntries(rows.map((row) => {
      if (row.group !== 'variable' || row.median <= 0) return [row.major, current[row.major] ?? '']
      const amount = Math.round((row.median * (1 - reduction / 100)) / 1_000) * 1_000
      return [row.major, amount > 0 ? String(amount) : '']
    })))
  }

  return (
    <form action={action} className="mt-6 space-y-6">
      <input name="targetMonth" type="hidden" value={targetMonth} />

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="font-semibold text-zinc-950">분류별 리뷰 · 다음 달 예산 제안</h2>
            <p className="mt-1 text-xs text-zinc-500">금액은 저장 전에 자유롭게 조정할 수 있습니다.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs font-medium text-zinc-600">변동비 절감률
              <span className="flex items-center gap-2"><input aria-label="변동비 절감률" className="w-20 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-right text-sm" max="50" min="0" onChange={(event) => setReduction(Number(event.target.value))} type="number" value={reduction} /><span>%</span></span>
            </label>
            <button className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50" onClick={reduceVariableBudgets} type="button">변동비에 적용</button>
          </div>
        </div>
      </section>

      {(['fixed', 'variable', 'irregular'] as ReviewGroup[]).map((group) => {
        const groupRows = rows.filter((row) => row.group === group)
        if (groupRows.length === 0) return null
        const info = groupInfo[group]
        return (
          <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm" key={group}>
            <div className={`border-b px-5 py-4 ${info.tone}`}>
              <h3 className="font-semibold text-zinc-950">{info.title}</h3>
              <p className="mt-1 text-xs text-zinc-600">{info.note}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr><th className="px-5 py-3 text-left font-medium">분류</th><th className="px-3 py-3 text-right font-medium">지난달 예산</th><th className="px-3 py-3 text-right font-medium">지난달 실제</th><th className="px-3 py-3 text-right font-medium">차이</th><th className="px-3 py-3 text-right font-medium">6개월 중앙값</th><th className="px-5 py-3 text-right font-medium">다음 달 예산</th></tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {groupRows.map((row) => (
                    <tr key={row.major}>
                      <td className="px-5 py-3"><p className="font-medium text-zinc-900">{row.major}</p>{row.existing !== null && <p className="mt-1 text-xs text-emerald-700">저장된 다음 달 예산</p>}</td>
                      <td className="px-3 py-3 text-right text-zinc-600">{row.previousBudget ? `${formatWon(row.previousBudget)}원` : '—'}</td>
                      <td className="px-3 py-3 text-right text-zinc-700">{row.previousActual ? `${formatWon(row.previousActual)}원` : '—'}</td>
                      <td className={`px-3 py-3 text-right ${row.difference > 0 ? 'text-rose-700' : row.difference < 0 ? 'text-emerald-700' : 'text-zinc-400'}`}>{row.previousBudget || row.previousActual ? `${row.difference > 0 ? '+' : ''}${formatWon(row.difference)}원` : '—'}</td>
                      <td className="px-3 py-3 text-right text-zinc-600">{row.median ? `${formatWon(row.median)}원` : '—'}</td>
                      <td className="px-5 py-3 text-right"><input aria-label={`${row.major} 다음 달 예산`} className="w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-right text-sm text-zinc-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" min="0" name={`budget:${row.major}`} onChange={(event) => setAmounts((current) => ({ ...current, [row.major]: event.target.value }))} placeholder="0" step="1000" type="number" value={amounts[row.major]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      <section className="sticky bottom-0 z-10 rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            <div><p className="text-xs text-zinc-500">제안 합계</p><p className="mt-1 font-semibold text-zinc-950">{formatWon(total)}원</p></div>
            <div><p className="text-xs text-zinc-500">목표 상한 대비</p><p className={`mt-1 font-semibold ${ceilingGap >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatWon(Math.abs(ceilingGap))}원 {ceilingGap >= 0 ? '여유' : '초과'}</p></div>
            <div><p className="text-xs text-zinc-500">예상 순저축률 · 목표 {savingsTarget}%</p><p className={`mt-1 font-semibold ${projectedRate >= savingsTarget ? 'text-emerald-700' : 'text-rose-700'}`}>{formatRate(projectedRate)}%</p></div>
          </div>
          <SaveButton targetMonth={targetMonth} />
        </div>
        {state.error && <p className="mt-3 text-sm text-rose-700">{state.error}</p>}
      </section>
    </form>
  )
}
