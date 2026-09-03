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
  fixed: { title: '고정비', note: '지난달 예산을 우선 유지', tone: 'border-finance-blue bg-finance-blue-tint' },
  variable: { title: '변동비', note: '최근 6개월 중앙값으로 제안', tone: 'border-finance-amber bg-finance-amber-tint' },
  irregular: { title: '비정기', note: '기존 월 적립액을 우선 유지', tone: 'border-finance-border bg-finance-track' },
}

const initialState: BudgetReviewActionState = {}

function SaveButton({ targetMonth }: { targetMonth: string }) {
  const { pending } = useFormStatus()
  return (
    <button className="h-[34px] bg-finance-ink px-4 t-body-strong text-white hover:opacity-80 disabled:opacity-60" disabled={pending} type="submit">
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

      <section className="border-t border-finance-ink py-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="t-section text-finance-ink">분류별 리뷰 · 다음 달 예산 제안</h2>
            <p className="mt-1 t-caption text-finance-muted">금액은 저장 전에 자유롭게 조정할 수 있습니다.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 t-caption font-medium text-finance-muted">변동비 절감률
              <span className="flex items-center gap-2"><input aria-label="변동비 절감률" className="h-[34px] w-20 border border-finance-hairline bg-white px-3 text-right t-body" max="50" min="0" onChange={(event) => setReduction(Number(event.target.value))} type="number" value={reduction} /><span>%</span></span>
            </label>
            <button className="h-[34px] border border-finance-hairline bg-white px-3 t-body-strong text-finance-ink hover:bg-finance-panel" onClick={reduceVariableBudgets} type="button">변동비에 적용</button>
          </div>
        </div>
      </section>

      {(['fixed', 'variable', 'irregular'] as ReviewGroup[]).map((group) => {
        const groupRows = rows.filter((row) => row.group === group)
        if (groupRows.length === 0) return null
        const info = groupInfo[group]
        return (
          <section className="overflow-hidden border-t border-finance-ink" key={group}>
            <div className="border-b border-finance-hairline py-4">
              <h3 className="t-section text-finance-ink">{info.title}</h3>
              <p className="mt-1 t-caption text-finance-muted">{info.note}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] t-body">
                <thead className="border-b border-finance-hairline bg-finance-panel t-label uppercase text-finance-muted">
                  <tr><th className="px-5 py-3 text-left font-medium">분류</th><th className="px-3 py-3 text-right font-medium">지난달 예산</th><th className="px-3 py-3 text-right font-medium">지난달 실제</th><th className="px-3 py-3 text-right font-medium">차이</th><th className="px-3 py-3 text-right font-medium">6개월 중앙값</th><th className="px-5 py-3 text-right font-medium">다음 달 예산</th></tr>
                </thead>
                <tbody className="divide-y divide-finance-hairline">
                  {groupRows.map((row) => (
                    <tr key={row.major}>
                      <td className="px-5 py-3"><p className="font-medium text-finance-ink">{row.major}</p>{row.existing !== null && <p className="mt-1 t-caption text-finance-green">저장된 다음 달 예산</p>}</td>
                      <td className="px-3 py-3 text-right text-finance-muted">{row.previousBudget ? `${formatWon(row.previousBudget)}원` : '—'}</td>
                      <td className="px-3 py-3 text-right text-finance-ink">{row.previousActual ? `${formatWon(row.previousActual)}원` : '—'}</td>
                      <td className={`px-3 py-3 text-right ${row.difference > 0 ? 'text-finance-red' : row.difference < 0 ? 'text-finance-green' : 'text-finance-faint'}`}>{row.previousBudget || row.previousActual ? `${row.difference > 0 ? '+' : ''}${formatWon(row.difference)}원` : '—'}</td>
                      <td className="px-3 py-3 text-right text-finance-muted">{row.median ? `${formatWon(row.median)}원` : '—'}</td>
                      <td className="px-5 py-3 text-right"><input aria-label={`${row.major} 다음 달 예산`} className="h-[34px] w-32 border border-finance-hairline bg-white px-3 text-right t-body tabular-nums text-finance-ink outline-none focus:border-finance-blue" min="0" name={`budget:${row.major}`} onChange={(event) => setAmounts((current) => ({ ...current, [row.major]: event.target.value }))} placeholder="0" step="1000" type="number" value={amounts[row.major]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      <section className="sticky bottom-0 z-10 border-y border-finance-ink bg-white/95 p-4 backdrop-blur">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            <div><p className="t-caption text-finance-muted">제안 합계</p><p className="mt-1 t-kpi-sm text-finance-ink">{formatWon(total)}원</p></div>
            <div><p className="t-caption text-finance-muted">목표 상한 대비</p><p className={`mt-1 t-kpi-sm ${ceilingGap >= 0 ? 'text-finance-green' : 'text-finance-red'}`}>{formatWon(Math.abs(ceilingGap))}원 {ceilingGap >= 0 ? '여유' : '초과'}</p></div>
            <div><p className="t-caption text-finance-muted">예상 순저축률 · 목표 {savingsTarget}%</p><p className={`mt-1 t-kpi-sm ${projectedRate >= savingsTarget ? 'text-finance-green' : 'text-finance-red'}`}>{formatRate(projectedRate)}%</p></div>
          </div>
          <SaveButton targetMonth={targetMonth} />
        </div>
        {state.error && <p className="mt-3 t-body text-finance-red">{state.error}</p>}
      </section>
    </form>
  )
}
