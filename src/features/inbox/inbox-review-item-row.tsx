'use client'

import type { Dispatch, SetStateAction } from 'react'

import type { TransactionFlow } from './banksalad'
import { flowLabel, SuggestionBadges, visibleSourceCategories } from './inbox-review-shared'
import type { AccountOption, InboxItem } from './inbox-review-types'
import { categoriesForFlow, categorySelectionForFlow, type InboxCategoryOption } from './taxonomy'

export type InboxRowState = {
  categories: InboxCategoryOption[]
  accounts: AccountOption[]
  flows: Record<number, TransactionFlow>
  categoryIds: Record<number, string>
  accountIds: Record<number, string>
  setFlows: Dispatch<SetStateAction<Record<number, TransactionFlow>>>
  setCategoryIds: Dispatch<SetStateAction<Record<number, string>>>
  setAccountIds: Dispatch<SetStateAction<Record<number, string>>>
  selected: Set<number>
  toggle: (id: number) => void
  applyingIds: Set<number>
  applySingleItem: (item: InboxItem) => void
}

export function InboxItemRow({ item, rowState }: { item: InboxItem; rowState: InboxRowState }) {
  const {
    categories,
    accounts,
    flows,
    categoryIds,
    accountIds,
    setFlows,
    setCategoryIds,
    setAccountIds,
    selected,
    toggle,
    applyingIds,
    applySingleItem,
  } = rowState
  const flow = flows[item.id] ?? item.flow
  const visibleCategories = categoriesForFlow(categories, flow)

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
          onChange={() => toggle(item.id)}
          type="checkbox"
        />
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{item.date}</td>
      <td className="max-w-64 px-3 py-3 text-zinc-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="break-words">{item.merchant || '-'}</span>
          {item.confidence === 'high' && (
            <span
              className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800"
              title="추천 신뢰도가 높은 거래입니다. 필요하면 직접 수정할 수 있습니다."
            >
              자동 분류
            </span>
          )}
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
        {visibleSourceCategories(item)}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <select
            className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700"
            onChange={(event) => {
              const nextFlow = event.target.value as TransactionFlow
              setFlows((current) => ({
                ...current,
                [item.id]: nextFlow,
              }))
              setCategoryIds((current) => ({
                ...current,
                [item.id]: categorySelectionForFlow(
                  categories,
                  nextFlow,
                  current[item.id],
                ),
              }))
            }}
            value={flow}
          >
            {Object.entries(flowLabel).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <SuggestionBadges item={item} />
          <select
            className="min-w-44 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700"
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
          onChange={(event) => setAccountIds((current) => ({
            ...current,
            [item.id]: event.target.value,
          }))}
          value={accountIds[item.id] ?? ''}
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
      <td className="px-4 py-3 text-right">
        <button
          aria-label={`${item.merchant || '거래'} 바로 반영`}
          className="inline-flex min-w-16 items-center justify-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
          disabled={applyingIds.has(item.id)}
          onClick={() => void applySingleItem(item)}
          title="현재 분류와 결제수단으로 바로 반영"
          type="button"
        >
          <span aria-hidden="true">✓</span>
          {applyingIds.has(item.id) ? '반영 중' : '반영'}
        </button>
      </td>
    </tr>
  )
}
