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
      className="border-t border-finance-track hover:bg-finance-panel"
      key={item.id}
    >
      <td className="px-3 py-3 text-center">
        <input
          aria-label={`${item.merchant ?? '거래'} 선택`}
          checked={selected.has(item.id)}
          className="h-4 w-4 accent-finance-ink"
          onChange={() => toggle(item.id)}
          type="checkbox"
        />
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-xs text-finance-muted">{item.date}</td>
      <td className="max-w-64 px-3 py-3 text-finance-ink">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="break-words">{item.merchant || '-'}</span>
          {item.confidence === 'high' && (
            <span
              className="bg-finance-green-tint px-2 py-0.5 text-[10px] font-semibold text-finance-green"
              title="추천 신뢰도가 높은 거래입니다. 필요하면 직접 수정할 수 있습니다."
            >
              자동 분류
            </span>
          )}
          {item.kind === 'transfer' && (
            <span className="bg-finance-green-tint px-2 py-0.5 text-[10px] font-semibold text-finance-green">
              이체 후보
            </span>
          )}
          {item.dupNote && (
            <span
              className="bg-finance-red-tint px-2 py-0.5 text-[10px] font-semibold text-finance-red"
              title={item.dupNote}
            >
              중복 의심
            </span>
          )}
        </div>
        {item.dupNote && <p className="mt-1 text-[11px] text-finance-red">{item.dupNote}</p>}
      </td>
      <td
        className={`whitespace-nowrap px-3 py-3 text-right font-medium ${
          flow === 'expense'
            ? 'text-finance-red'
            : flow === 'income'
              ? 'text-finance-blue'
              : 'text-finance-green'
        }`}
      >
        {flow === 'expense' ? '−' : '+'}{item.amount.toLocaleString('ko-KR')}원
      </td>
      <td className="px-3 py-3">
        <span
          className="border border-finance-border bg-white px-2 py-1 text-[10px] font-semibold text-finance-muted"
        >
          {item.owner}
        </span>
      </td>
      <td className="px-3 py-3 text-xs text-finance-muted">
        {visibleSourceCategories(item)}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <select
            aria-label={`${item.merchant || '거래'} 거래 유형`}
            className="h-[30px] w-20 border border-finance-border bg-white px-2 text-xs text-finance-ink outline-none focus:border-finance-blue"
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
            aria-label={`${item.merchant || '거래'} 카테고리`}
            className="h-[30px] min-w-44 flex-1 border border-finance-border bg-white px-2 text-xs text-finance-ink outline-none focus:border-finance-blue"
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
          aria-label={`${item.merchant || '거래'} 결제수단`}
          className="h-[30px] w-full border border-finance-border bg-white px-2 text-xs text-finance-ink outline-none focus:border-finance-blue"
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
        {item.pay && <p className="mt-1 truncate text-[11px] text-finance-faint" title={item.pay}>{item.pay}</p>}
      </td>
      <td className="px-3 py-3 text-right">
        <button
          aria-label={`${item.merchant || '거래'} 바로 반영`}
          className="inline-flex h-[30px] min-w-16 items-center justify-center gap-1 bg-finance-green px-3 text-xs font-semibold text-white hover:bg-finance-ink disabled:cursor-wait disabled:opacity-50"
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
