'use client'

import { useState } from 'react'

import { formatWon } from '@/lib/finance'

import {
  accountTableMonths,
  type AccountMonthlyData,
  type CategoryMonthlyData,
} from './account-monthly'
import { AccountMonthlyChart, CategoryMonthlyChart } from './charts'
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
    <div aria-label="거래 유형" className="inline-flex rounded-lg bg-zinc-100 p-1" role="group">
      {flows.map((option) => (
        <button
          aria-pressed={flow === option}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${flow === option ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}
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
    <section className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
        <div>
          <h2 className="font-semibold text-zinc-950">결제수단별 월별</h2>
          <p className="mt-1 text-xs text-zinc-500">월별 {FLOW_LABELS[flow]} · 누적 막대와 합계표</p>
        </div>
        <FlowButtons flow={flow} flows={['expense', 'income']} onChange={setFlow} />
      </div>

      {selected.accounts.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-zinc-500">데이터가 없습니다.</p>
      ) : (
        <>
          <div className="overflow-x-auto px-5 py-5">
            <AccountMonthlyChart data={selected} key={flow} />
          </div>
          <div className="overflow-x-auto border-t border-zinc-200">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-5 py-3 font-medium">결제수단</th>
                  {months.map((month) => <th className="px-3 py-3 text-right font-medium" key={month}>{month}월</th>)}
                  <th className="px-5 py-3 text-right font-medium">합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {selected.accounts.map((account) => {
                  const values = selected.series[account]
                  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
                  return (
                    <tr key={account}>
                      <th className="px-5 py-3 font-medium text-zinc-700" scope="row">{account}</th>
                      {months.map((month) => (
                        <td className="px-3 py-3 text-right tabular-nums text-zinc-600" key={month}>
                          {values[month - 1] ? formatWon(values[month - 1]!) : '-'}
                        </td>
                      ))}
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-zinc-900">{formatWon(total)}</td>
                    </tr>
                  )
                })}
                <tr className="bg-zinc-50 font-semibold text-zinc-900">
                  <th className="px-5 py-3" scope="row">합계</th>
                  {months.map((month) => (
                    <td className="px-3 py-3 text-right tabular-nums" key={month}>
                      {formatWon(selected.accounts.reduce(
                        (sum, account) => sum + (selected.series[account][month - 1] ?? 0),
                        0,
                      ))}
                    </td>
                  ))}
                  <td className="px-5 py-3 text-right tabular-nums">
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
    <section className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
        <div>
          <h2 className="font-semibold text-zinc-950">분류별 월별 추이</h2>
          <p className="mt-1 text-xs text-zinc-500">범례를 클릭해 선을 숨기고, 마우스를 올려 한 분류를 강조합니다.</p>
        </div>
        <FlowButtons flow={flow} flows={['expense', 'income', 'saving']} onChange={setFlow} />
      </div>
      {selected.categories.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-zinc-500">데이터가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto px-5 py-5">
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
