'use client'

import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { processInbox } from './actions'
import type { TransactionFlow } from './banksalad'
import { formatInboxMonth, groupInboxItemsByMonth } from './grouping'

type InboxItem = {
  id: number
  owner: string
  date: string
  merchant: string | null
  amount: number
  flow: TransactionFlow
  kind: 'normal' | 'transfer'
  bsCat1: string | null
  bsCat2: string | null
  pay: string | null
  accountId: number | null
  categoryId: number | null
  memo: string | null
  sugSource: string | null
  dupNote: string | null
}

type CategoryOption = {
  id: number
  kind: TransactionFlow
  major: string
  sub: string
}

type AccountOption = {
  id: number
  name: string
  owner: string | null
}

type InboxReviewFormProps = {
  items: InboxItem[]
  categories: CategoryOption[]
  accounts: AccountOption[]
}

const flowLabel: Record<TransactionFlow, string> = {
  expense: '지출',
  income: '수입',
  saving: '저축',
}

function ActionButtons({ selectedCount }: { selectedCount: number }) {
  const { pending } = useFormStatus()
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        disabled={pending || selectedCount === 0}
        name="intent"
        type="submit"
        value="dismiss"
      >
        {pending ? '처리 중…' : '선택 제외'}
      </button>
      <button
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        disabled={pending || selectedCount === 0}
        name="intent"
        type="submit"
        value="apply"
      >
        {pending ? '처리 중…' : '선택 반영'}
      </button>
    </div>
  )
}

export function InboxReviewForm({ items, categories, accounts }: InboxReviewFormProps) {
  const monthGroups = useMemo(() => groupInboxItemsByMonth(items), [items])
  const [selected, setSelected] = useState(
    () => new Set(items.filter((item) => !item.dupNote).map((item) => item.id)),
  )
  const [expandedMonths, setExpandedMonths] = useState(
    () => new Set(items.map((item) => item.date.slice(0, 7))),
  )
  const [flows, setFlows] = useState<Record<number, TransactionFlow>>(
    () => Object.fromEntries(items.map((item) => [item.id, item.flow])),
  )
  const [categoryIds, setCategoryIds] = useState<Record<number, string>>(
    () => Object.fromEntries(items.map((item) => [item.id, item.categoryId?.toString() ?? ''])),
  )

  const selectedTotal = useMemo(
    () =>
      items.reduce((total, item) => {
        if (!selected.has(item.id)) return total
        return total + (flows[item.id] === 'income' ? item.amount : -item.amount)
      }, 0),
    [flows, items, selected],
  )

  const toggle = (id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleMonth = (month: string) => {
    setExpandedMonths((current) => {
      const next = new Set(current)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }

  return (
    <form action={processInbox}>
      <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            className="font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950"
            onClick={() => setSelected(new Set(items.map((item) => item.id)))}
            type="button"
          >
            전체 선택
          </button>
          <button
            className="text-zinc-500 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950"
            onClick={() => setSelected(new Set())}
            type="button"
          >
            선택 해제
          </button>
          <span aria-hidden="true" className="h-4 border-l border-zinc-300" />
          <button
            className="text-zinc-500 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 disabled:text-zinc-300"
            disabled={expandedMonths.size === monthGroups.length}
            onClick={() => setExpandedMonths(new Set(monthGroups.map((group) => group.month)))}
            type="button"
          >
            월 전체 펼치기
          </button>
          <button
            className="text-zinc-500 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 disabled:text-zinc-300"
            disabled={expandedMonths.size === 0}
            onClick={() => setExpandedMonths(new Set())}
            type="button"
          >
            월 전체 접기
          </button>
          <span className="text-zinc-500">
            {selected.size}건 · 합계 {selectedTotal >= 0 ? '+' : '−'}
            {Math.abs(selectedTotal).toLocaleString('ko-KR')}원
          </span>
        </div>
        <ActionButtons selectedCount={selected.size} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="w-10 px-4 py-3 font-medium">선택</th>
                <th className="px-3 py-3 font-medium">날짜</th>
                <th className="px-3 py-3 font-medium">가맹점</th>
                <th className="px-3 py-3 text-right font-medium">금액</th>
                <th className="px-3 py-3 font-medium">소유자</th>
                <th className="px-3 py-3 font-medium">뱅샐 분류</th>
                <th className="min-w-72 px-3 py-3 font-medium">반영 분류</th>
                <th className="min-w-48 px-3 py-3 font-medium">결제수단</th>
              </tr>
            </thead>
            {monthGroups.map((group) => {
              const expanded = expandedMonths.has(group.month)
              const selectedItems = group.items.filter((item) => selected.has(item.id))
              const selectedAmount = selectedItems.reduce(
                (total, item) => total + (flows[item.id] === 'income' ? item.amount : -item.amount),
                0,
              )
              const duplicateCount = group.items.filter((item) => item.dupNote).length

              return (
                <tbody className="border-t border-zinc-200 first:border-t-0" key={group.month}>
                  <tr className="bg-zinc-100/80">
                    <th className="p-0" colSpan={8}>
                      <button
                        aria-expanded={expanded}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600"
                        onClick={() => toggleMonth(group.month)}
                        type="button"
                      >
                        <span aria-hidden="true" className="w-4 text-center text-sm text-zinc-500">
                          {expanded ? '▾' : '▸'}
                        </span>
                        <span className="font-semibold text-zinc-900">{formatInboxMonth(group.month)}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-zinc-600">
                          {group.items.length}건
                        </span>
                        {duplicateCount > 0 && (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                            중복 의심 {duplicateCount}건
                          </span>
                        )}
                        <span className="ml-auto whitespace-nowrap text-xs font-normal text-zinc-500">
                          선택 {selectedItems.length}/{group.items.length}건 · {selectedAmount >= 0 ? '+' : '−'}
                          {Math.abs(selectedAmount).toLocaleString('ko-KR')}원
                        </span>
                      </button>
                    </th>
                  </tr>
                  {expanded && group.items.map((item) => {
                    const flow = flows[item.id]
                    const visibleCategories = categories.filter((category) => category.kind === flow)
                    return (
                  <tr
                    className={`border-t border-zinc-100 ${item.dupNote ? 'bg-rose-50/70 hover:bg-rose-50' : 'hover:bg-zinc-50'}`}
                    key={item.id}
                  >
                    <td className="px-4 py-3 text-center">
                      <input
                        aria-label={`${item.merchant ?? '거래'} 선택`}
                        checked={selected.has(item.id)}
                        className="h-4 w-4 accent-emerald-700"
                        name="ids"
                        onChange={() => toggle(item.id)}
                        type="checkbox"
                        value={item.id}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{item.date.slice(5)}</td>
                    <td className="max-w-64 px-3 py-3 text-zinc-800">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="break-words">{item.merchant || '-'}</span>
                        {item.kind === 'transfer' && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                            이체 후보
                          </span>
                        )}
                        {item.dupNote && (
                          <span
                            className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800"
                            title={item.dupNote}
                          >
                            중복 의심
                          </span>
                        )}
                      </div>
                      {item.dupNote && <p className="mt-1 text-[11px] text-rose-700">{item.dupNote}</p>}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-3 text-right font-medium ${
                        flow === 'expense'
                          ? 'text-rose-700'
                          : flow === 'income'
                            ? 'text-blue-700'
                            : 'text-emerald-700'
                      }`}
                    >
                      {flow === 'expense' ? '−' : '+'}{item.amount.toLocaleString('ko-KR')}원
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          item.owner === 'DJ'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-fuchsia-50 text-fuchsia-700'
                        }`}
                      >
                        {item.owner}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-500">
                      {[item.bsCat1, item.bsCat2].filter(Boolean).join(' / ') || '-'}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700"
                          name={`flow_${item.id}`}
                          onChange={(event) => {
                            setFlows((current) => ({
                              ...current,
                              [item.id]: event.target.value as TransactionFlow,
                            }))
                            setCategoryIds((current) => ({ ...current, [item.id]: '' }))
                          }}
                          value={flow}
                        >
                          {Object.entries(flowLabel).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                        {item.sugSource && (
                          <span
                            className={`shrink-0 rounded px-1.5 py-1 text-[10px] font-medium ${
                              item.sugSource === 'history'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-zinc-100 text-zinc-500'
                            }`}
                          >
                            {item.sugSource === 'history' ? '이력' : '뱅샐'}
                          </span>
                        )}
                        <select
                          className="min-w-44 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700"
                          name={`category_${item.id}`}
                          onChange={(event) =>
                            setCategoryIds((current) => ({ ...current, [item.id]: event.target.value }))
                          }
                          value={categoryIds[item.id] ?? ''}
                        >
                          <option value="">미분류</option>
                          {visibleCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.major} · {category.sub}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700"
                        defaultValue={item.accountId ?? ''}
                        name={`account_${item.id}`}
                      >
                        <option value="">선택 안 함</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}{account.owner ? ` · ${account.owner}` : ''}
                          </option>
                        ))}
                      </select>
                      {item.pay && <p className="mt-1 truncate text-[11px] text-zinc-400" title={item.pay}>{item.pay}</p>}
                    </td>
                  </tr>
                    )
                  })}
                </tbody>
              )
            })}
          </table>
        </div>
      </div>

      <div className="mt-3">
        <ActionButtons selectedCount={selected.size} />
      </div>
    </form>
  )
}
