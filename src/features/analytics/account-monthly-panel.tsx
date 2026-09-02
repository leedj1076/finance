'use client'

import { useState } from 'react'

import { formatWon } from '@/lib/finance'

import {
  accountTableMonths,
  type AccountMonthlyData,
  type CategoryMonthlyData,
} from './account-monthly'
import { AccountMonthlyChart } from './account-monthly-chart'
import { CategoryMonthlyChart } from './category-monthly-chart'
import { categoryPageUrl } from './category-url'

type AccountFlow = 'expense' | 'income'
type CategoryFlow = AccountFlow | 'saving'

const FLOW_LABELS: Record<CategoryFlow, string> = {
  expense: '지출',
  income: '수입',
  saving: '저축',
}

function FlowButtons<T extends CategoryFlow>({
  flow,
  flows,
  onChange,
}: {
  flow: T
  flows: T[]
  onChange: (flow: T) => void
}) {
  return (
    <div aria-label="거래 유형" className="inline-flex border border-finance-border" role="group">
      {flows.map((option) => (
        <button
          aria-pressed={flow === option}
          className={`h-[30px] border-l border-finance-border px-3.5 text-xs font-medium first:border-l-0 ${flow === option ? 'bg-finance-ink font-semibold text-white' : 'text-finance-muted hover:bg-finance-track hover:text-finance-ink'}`}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {FLOW_LABELS[option]}
        </button>
      ))}
    </div>
  )
}

export function AccountMonthlyPanel({
  data,
}: {
  data: Record<AccountFlow, AccountMonthlyData>
}) {
  const [flow, setFlow] = useState<AccountFlow>('expense')
  const selected = data[flow]
  const months = accountTableMonths(selected)

  return (
    <section className="mt-6 border-b border-finance-border pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-finance-ink pt-4">
        <div>
          <h2 className="text-sm font-bold text-finance-ink">결제수단별 월별</h2>
          <p className="mt-1 text-xs text-finance-muted">월별 {FLOW_LABELS[flow]} · 누적 막대와 합계표</p>
        </div>
        <FlowButtons flow={flow} flows={['expense', 'income']} onChange={setFlow} />
      </div>

      {selected.accounts.length === 0 ? (
        <p className="py-12 text-center text-[13px] text-finance-muted">데이터가 없습니다.</p>
      ) : (
        <>
          <div className="overflow-x-auto py-5">
            <AccountMonthlyChart data={selected} key={flow} />
          </div>
          <div className="overflow-x-auto border-t border-finance-ink">
            <table className="w-full min-w-[680px] text-left text-[13px]">
              <thead className="border-b border-finance-border text-[11px] font-semibold uppercase tracking-[0.06em] text-finance-muted">
                <tr>
                  <th className="py-[9px] pr-3 font-semibold">결제수단</th>
                  {months.map((month) => <th className="px-3 py-[9px] text-right font-semibold" key={month}>{month}월</th>)}
                  <th className="py-[9px] pl-3 text-right font-semibold">합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-finance-track">
                {selected.accounts.map((account) => {
                  const values = selected.series[account]
                  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
                  return (
                    <tr key={account}>
                      <th className="py-3 pr-3 font-medium text-finance-ink" scope="row">{account}</th>
                      {months.map((month) => (
                        <td className="px-3 py-3 text-right tabular-nums text-finance-muted" key={month}>
                          {values[month - 1] ? formatWon(values[month - 1]!) : '-'}
                        </td>
                      ))}
                      <td className="py-3 pl-3 text-right font-semibold tabular-nums text-finance-ink">{formatWon(total)}</td>
                    </tr>
                  )
                })}
                <tr className="border-t border-finance-ink bg-finance-panel font-semibold text-finance-ink">
                  <th className="py-3 pr-3" scope="row">합계</th>
                  {months.map((month) => (
                    <td className="px-3 py-3 text-right tabular-nums" key={month}>
                      {formatWon(selected.accounts.reduce(
                        (sum, account) => sum + (selected.series[account][month - 1] ?? 0),
                        0,
                      ))}
                    </td>
                  ))}
                  <td className="py-3 pl-3 text-right tabular-nums">
                    {formatWon(selected.accounts.reduce(
                      (sum, account) => sum + selected.series[account].reduce<number>(
                        (accountSum, value) => accountSum + (value ?? 0),
                        0,
                      ),
                      0,
                    ))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

export function CategoryMonthlyPanel({
  data,
  year,
}: {
  data: Record<CategoryFlow, CategoryMonthlyData>
  year: number
}) {
  const [flow, setFlow] = useState<CategoryFlow>('expense')
  const selected = data[flow]

  return (
    <section className="mt-6 border-b border-finance-border pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-finance-ink pt-4">
        <div>
          <h2 className="text-sm font-bold text-finance-ink">분류별 월별 추이</h2>
          <p className="mt-1 text-xs text-finance-muted">범례를 클릭해 선을 숨기고, 마우스를 올려 한 분류를 강조합니다.</p>
        </div>
        <FlowButtons flow={flow} flows={['expense', 'income', 'saving']} onChange={setFlow} />
      </div>
      {selected.categories.length === 0 ? (
        <p className="py-12 text-center text-[13px] text-finance-muted">데이터가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto py-5">
          <CategoryMonthlyChart
            data={selected}
            detailHref={(major) => categoryPageUrl({ flow, major, period: { year } })}
            key={flow}
          />
        </div>
      )}
    </section>
  )
}
