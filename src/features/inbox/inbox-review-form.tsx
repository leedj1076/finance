'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'

import { applyInboxItem, processInbox } from './actions'
import type { TransactionFlow } from './banksalad'
import { groupInboxItemsByMonthAndPaymentSource } from './grouping'
import type { InboxRowState } from './inbox-review-item-row'
import { InboxMonthGroup } from './inbox-review-month-group'
import { ActionButtons } from './inbox-review-shared'
import type { AccountOption, InboxItem } from './inbox-review-types'
import { categorySelectionForFlow, type InboxCategoryOption } from './taxonomy'

type InboxReviewFormProps = {
  highItems: InboxItem[]
  reviewItems: InboxItem[]
  categories: InboxCategoryOption[]
  accounts: AccountOption[]
}

export function InboxReviewForm({ highItems, reviewItems, categories, accounts }: InboxReviewFormProps) {
  const allItems = useMemo(
    () => [...highItems, ...reviewItems].sort(
      (left, right) => right.date.localeCompare(left.date) || right.id - left.id,
    ),
    [highItems, reviewItems],
  )
  const [appliedIds, setAppliedIds] = useState<Set<number>>(() => new Set())
  const items = useMemo(
    () => allItems.filter((item) => !appliedIds.has(item.id)),
    [allItems, appliedIds],
  )
  const monthGroups = useMemo(() => groupInboxItemsByMonthAndPaymentSource(items), [items])
  const sourceGroups = useMemo(
    () => monthGroups.flatMap((monthGroup) => monthGroup.sources),
    [monthGroups],
  )
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [expandedSources, setExpandedSources] = useState(
    () => new Set(sourceGroups.map((group) => group.key)),
  )
  const [expandedMonths, setExpandedMonths] = useState(
    () => new Set(monthGroups.map((group) => group.month)),
  )
  const [flows, setFlows] = useState<Record<number, TransactionFlow>>(
    () => Object.fromEntries(items.map((item) => [item.id, item.flow])),
  )
  const [categoryIds, setCategoryIds] = useState<Record<number, string>>(
    () => Object.fromEntries(
      items.map((item) => [
        item.id,
        categorySelectionForFlow(categories, item.flow, item.categoryId),
      ]),
    ),
  )
  const [accountIds, setAccountIds] = useState<Record<number, string>>(
    () => Object.fromEntries(items.map((item) => [item.id, item.accountId ? String(item.accountId) : ''])),
  )
  const [applyingIds, setApplyingIds] = useState<Set<number>>(() => new Set())
  const [actionMessage, setActionMessage] = useState<{
    kind: 'success' | 'error'
    text: string
  } | null>(null)

  useEffect(() => {
    const activeIds = new Set(items.map((item) => item.id))
    setSelected((current) => new Set([...current].filter((id) => activeIds.has(id))))
    setFlows((current) => Object.fromEntries(
      items.map((item) => [item.id, current[item.id] ?? item.flow]),
    ))
    setCategoryIds((current) => Object.fromEntries(
      items.map((item) => [
        item.id,
        current[item.id] ?? categorySelectionForFlow(categories, item.flow, item.categoryId),
      ]),
    ))
    setAccountIds((current) => Object.fromEntries(
      items.map((item) => [
        item.id,
        current[item.id] ?? (item.accountId ? String(item.accountId) : ''),
      ]),
    ))
  }, [categories, items])

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

  const toggleSource = (key: string) => {
    setExpandedSources((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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

  const setSourceAccount = (itemIds: number[], accountId: string) => {
    setAccountIds((current) => {
      const next = { ...current }
      for (const id of itemIds) next[id] = accountId
      return next
    })
  }

  const toggleItems = (itemIds: number[], select: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      for (const id of itemIds) {
        if (select) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const applySingleItem = async (item: InboxItem) => {
    setApplyingIds((current) => new Set(current).add(item.id))
    setActionMessage(null)

    try {
      const result = await applyInboxItem({
        id: item.id,
        flow: flows[item.id] ?? item.flow,
        categoryId: categoryIds[item.id] ? Number(categoryIds[item.id]) : null,
        accountId: accountIds[item.id] ? Number(accountIds[item.id]) : null,
      })
      if (result.error) {
        setActionMessage({ kind: 'error', text: result.error })
        return
      }

      setAppliedIds((current) => new Set(current).add(item.id))
      setActionMessage({
        kind: 'success',
        text: result.message ?? `${item.merchant || '거래'}을(를) 가계부에 반영했습니다.`,
      })
    } catch {
      setActionMessage({
        kind: 'error',
        text: '거래를 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      })
    } finally {
      setApplyingIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  const highConfidenceIds = items
    .filter((item) => item.confidence === 'high')
    .map((item) => item.id)

  const rowState: InboxRowState = {
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
  }

  return (
    items.length > 0 ? (
      <section>
        <div className="mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-zinc-950">확인 대기 {items.length}건</h3>
            {highConfidenceIds.length > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                자동 분류 {highConfidenceIds.length}건
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500">모든 거래를 바로 수정할 수 있습니다. 한 건씩 오른쪽에서 즉시 반영하거나, 체크박스로 여러 건을 선택해 한 번에 처리하세요.</p>
        </div>
      {actionMessage && (
        <div
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
          actionMessage.kind === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
          role="status"
        >
          <span>{actionMessage.text}</span>
          <button
            aria-label="알림 닫기"
            className="-mr-1 shrink-0 rounded px-1 text-current opacity-60 hover:opacity-100"
            onClick={() => setActionMessage(null)}
            type="button"
          >
            ×
          </button>
        </div>
      )}
      <form action={processInbox}>
      {items.filter((item) => selected.has(item.id)).map((item) => (
        <Fragment key={`selected-${item.id}`}>
          <input name="ids" type="hidden" value={item.id} />
          <input name={`flow_${item.id}`} type="hidden" value={flows[item.id] ?? item.flow} />
          <input name={`category_${item.id}`} type="hidden" value={categoryIds[item.id] ?? ''} />
          <input name={`account_${item.id}`} type="hidden" value={accountIds[item.id] ?? ''} />
        </Fragment>
      ))}
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
          {highConfidenceIds.length > 0 && (
            <button
              className="text-emerald-700 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-900"
              onClick={() => toggleItems(highConfidenceIds, true)}
              type="button"
            >
              자동 분류만 선택
            </button>
          )}
          <span aria-hidden="true" className="h-4 border-l border-zinc-300" />
          <button
            className="text-zinc-500 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 disabled:text-zinc-300"
            disabled={expandedSources.size === sourceGroups.length}
            onClick={() => setExpandedSources(new Set(sourceGroups.map((group) => group.key)))}
            type="button"
          >
            결제수단 전체 펼치기
          </button>
          <button
            className="text-zinc-500 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 disabled:text-zinc-300"
            disabled={expandedSources.size === 0}
            onClick={() => setExpandedSources(new Set())}
            type="button"
          >
            결제수단 전체 접기
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
          <table className="w-full min-w-[1280px] text-left text-sm">
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
                <th className="w-24 px-4 py-3 text-right font-medium">바로 반영</th>
              </tr>
            </thead>
            {monthGroups.map((monthGroup) => (
              <InboxMonthGroup
                accounts={accounts}
                expandedSources={expandedSources}
                key={monthGroup.month}
                monthExpanded={expandedMonths.has(monthGroup.month)}
                monthGroup={monthGroup}
                rowState={rowState}
                selected={selected}
                setSourceAccount={setSourceAccount}
                toggleItems={toggleItems}
                toggleMonth={toggleMonth}
                toggleSource={toggleSource}
              />
            ))}
          </table>
        </div>
      </div>

      <div className="mt-3">
        <ActionButtons selectedCount={selected.size} />
      </div>
      </form>
      </section>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center">
          <p className="font-medium text-emerald-900">모든 대기 거래를 처리했습니다.</p>
          <p className="mt-2 text-sm text-emerald-700">새 거래 파일을 올리면 이곳에서 다시 확인할 수 있습니다.</p>
        </div>
      )
  )
}
