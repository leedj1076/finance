'use client'

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'

import { approveHighConfidence, demoteToReview, processInbox } from './actions'
import type { TransactionFlow } from './banksalad'
import {
  formatInboxMonth,
  formatInboxPaymentSource,
  groupInboxItemsByMonthAndPaymentSource,
} from './grouping'
import {
  categoriesForFlow,
  categorySelectionForFlow,
  type InboxCategoryOption,
} from './taxonomy'

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
  confidence: string
  businessType: string | null
  aiNote: string | null
  alwaysConfirm: boolean
  categoryLabel: string | null
}

type AccountOption = {
  id: number
  name: string
  owner: string | null
}

type InboxReviewFormProps = {
  highItems: InboxItem[]
  reviewItems: InboxItem[]
  categories: InboxCategoryOption[]
  accounts: AccountOption[]
}

const flowLabel: Record<TransactionFlow, string> = {
  expense: '지출',
  income: '수입',
  saving: '저축',
}

function paymentSourceLabel(
  group: { accountId: number | null; owner: string; pay: string | null },
  accounts: AccountOption[],
) {
  const accountName = group.accountId === null
    ? undefined
    : accounts.find((account) => account.id === group.accountId)?.name
  return formatInboxPaymentSource(group, accountName)
}

function visibleSourceCategories(item: Pick<InboxItem, 'bsCat1' | 'bsCat2'>) {
  return [item.bsCat1, item.bsCat2]
    .filter((value): value is string => value !== null && value !== '' && !value.startsWith('__source:'))
    .join(' / ') || '-'
}

const sourceStyle: Record<string, { label: string; className: string }> = {
  user: { label: '캐시', className: 'bg-emerald-100 text-emerald-800' },
  history: { label: '이력', className: 'bg-emerald-50 text-emerald-700' },
  ai: { label: 'AI', className: 'bg-violet-100 text-violet-800' },
  banksalad: { label: '뱅샐', className: 'bg-zinc-100 text-zinc-600' },
}

function SuggestionBadges({ item }: { item: InboxItem }) {
  const source = item.sugSource ? sourceStyle[item.sugSource] : null
  const evidence = [item.businessType, item.aiNote].filter(Boolean).join(' · ')
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {source && (
        <span
          className={`shrink-0 rounded px-1.5 py-1 text-[10px] font-medium ${source.className}`}
          title={evidence || undefined}
        >
          {source.label}
        </span>
      )}
      {item.alwaysConfirm && (
        <span
          className="shrink-0 rounded bg-amber-100 px-1.5 py-1 text-[10px] font-medium text-amber-800"
          title="구매 품목을 알 수 없는 결제대행 가맹점이라 직접 확인이 필요합니다."
        >
          애그리게이터
        </span>
      )}
    </span>
  )
}

function HighConfidenceSection({ items, accounts }: { items: InboxItem[]; accounts: AccountOption[] }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const monthGroups = useMemo(() => groupInboxItemsByMonthAndPaymentSource(items), [items])
  const total = items.reduce(
    (sum, item) => sum + (item.flow === 'income' ? item.amount : -item.amount),
    0,
  )

  if (items.length === 0) return null

  return (
    <details className="mb-6 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 bg-emerald-50 px-5 py-4 marker:hidden">
        <span aria-hidden="true" className="text-emerald-700">✓</span>
        <span className="font-semibold text-emerald-950">자동 분류됨 {items.length}건</span>
        <span className="text-sm text-emerald-700">
          합계 {total >= 0 ? '+' : '−'}{Math.abs(total).toLocaleString('ko-KR')}원
        </span>
        <button
          className="ml-auto rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          disabled={pending}
          onClick={(event) => {
            event.preventDefault()
            startTransition(async () => {
              const result = await approveHighConfidence()
              setMessage(result.error ?? `${result.applied ?? 0}건을 가계부에 반영했습니다.`)
            })
          }}
          type="button"
        >
          {pending ? '반영 중…' : `${items.length}건 일괄 승인`}
        </button>
      </summary>
      {message && <p className="border-t border-emerald-100 px-5 py-3 text-sm text-emerald-800">{message}</p>}
      <div className="overflow-x-auto border-t border-emerald-100">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">날짜</th>
              <th className="px-3 py-3 font-medium">가맹점</th>
              <th className="px-3 py-3 font-medium">근거</th>
              <th className="px-3 py-3 font-medium">분류</th>
              <th className="px-3 py-3 text-right font-medium">금액</th>
              <th className="px-4 py-3 text-right font-medium">수정</th>
            </tr>
          </thead>
          {monthGroups.map((monthGroup) => (
            <Fragment key={monthGroup.month}>
              <tbody className="border-t border-emerald-200 first:border-t-0">
                <tr className="bg-emerald-100/70">
                  <th className="px-4 py-3 text-sm font-bold text-emerald-950" colSpan={6}>
                    {formatInboxMonth(monthGroup.month)}
                    <span className="ml-2 text-xs font-medium text-emerald-700">{monthGroup.items.length}건</span>
                  </th>
                </tr>
              </tbody>
              {monthGroup.sources.map((group) => (
                <tbody className="border-t border-emerald-100" key={group.key}>
                  <tr className="bg-emerald-50/60">
                    <th className="px-4 py-2.5 text-xs font-semibold text-emerald-900" colSpan={6}>
                      {paymentSourceLabel(group, accounts)} · {group.items.length}건
                    </th>
                  </tr>
                  {group.items.map((item) => (
                    <tr className="border-t border-zinc-100" key={item.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-500">{item.date.slice(5)}</td>
                      <td className="px-3 py-3 font-medium text-zinc-900">{item.merchant || '-'}</td>
                      <td className="px-3 py-3"><SuggestionBadges item={item} /></td>
                      <td className="px-3 py-3 text-zinc-600">{item.categoryLabel || '미분류'}</td>
                      <td className={`whitespace-nowrap px-3 py-3 text-right font-medium ${item.flow === 'expense' ? 'text-rose-700' : item.flow === 'income' ? 'text-blue-700' : 'text-emerald-700'}`}>
                        {item.flow === 'expense' ? '−' : '+'}{item.amount.toLocaleString('ko-KR')}원
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                          disabled={pending}
                          onClick={() => startTransition(async () => {
                            const result = await demoteToReview(item.id)
                            if (result?.error) setMessage(result.error)
                          })}
                          type="button"
                        >
                          수정
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </Fragment>
          ))}
        </table>
      </div>
    </details>
  )
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

function GroupSelectionCheckbox({
  label,
  itemIds,
  selected,
  onToggle,
}: {
  label: string
  itemIds: number[]
  selected: Set<number>
  onToggle: (ids: number[], select: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedCount = itemIds.filter((id) => selected.has(id)).length
  const allSelected = itemIds.length > 0 && selectedCount === itemIds.length

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = selectedCount > 0 && !allSelected
    }
  }, [allSelected, selectedCount])

  return (
    <input
      aria-label={`${label} 그룹 선택`}
      checked={allSelected}
      className="h-4 w-4 shrink-0 accent-emerald-700"
      onChange={() => onToggle(itemIds, !allSelected)}
      ref={inputRef}
      type="checkbox"
    />
  )
}

export function InboxReviewForm({ highItems, reviewItems, categories, accounts }: InboxReviewFormProps) {
  const items = reviewItems
  const monthGroups = useMemo(() => groupInboxItemsByMonthAndPaymentSource(items), [items])
  const sourceGroups = useMemo(
    () => monthGroups.flatMap((monthGroup) => monthGroup.sources),
    [monthGroups],
  )
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [expandedSources, setExpandedSources] = useState(
    () => new Set(sourceGroups.map((group) => group.key)),
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

  return (
    <>
      <HighConfidenceSection accounts={accounts} items={highItems} />
      {items.length > 0 ? (
      <section>
        <div className="mb-3">
          <h3 className="font-semibold text-zinc-950">확인 필요 {items.length}건</h3>
          <p className="mt-1 text-xs text-zinc-500">기본 선택은 0건입니다. 월 또는 결제수단 왼쪽 체크박스로 해당 그룹을 한 번에 선택할 수 있습니다.</p>
        </div>
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
            {monthGroups.map((monthGroup) => (
              <Fragment key={monthGroup.month}>
                <tbody className="border-t border-zinc-300 first:border-t-0">
                  <tr className="bg-zinc-800 text-white">
                    <th className="p-0" colSpan={8}>
                      <div className="flex min-h-14 items-center gap-3 px-4 py-3">
                        <GroupSelectionCheckbox
                          itemIds={monthGroup.items.map((item) => item.id)}
                          label={formatInboxMonth(monthGroup.month)}
                          onToggle={toggleItems}
                          selected={selected}
                        />
                        <span className="font-bold">{formatInboxMonth(monthGroup.month)}</span>
                        <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium text-zinc-100">
                          {monthGroup.items.length}건
                        </span>
                        <span className="ml-auto text-xs font-normal text-zinc-300">
                          결제수단 {monthGroup.sources.length}개
                        </span>
                      </div>
                    </th>
                  </tr>
                </tbody>
                {monthGroup.sources.map((group) => {
              const expanded = expandedSources.has(group.key)
              const selectedItems = group.items.filter((item) => selected.has(item.id))
              const selectedAmount = selectedItems.reduce(
                (total, item) => total + (flows[item.id] === 'income' ? item.amount : -item.amount),
                0,
              )
              const duplicateCount = group.items.filter((item) => item.dupNote).length
              const groupAccountIds = [...new Set(group.items.map((item) => accountIds[item.id] ?? ''))]
              const groupAccountId = groupAccountIds.length === 1 ? groupAccountIds[0] : ''
              const groupAccounts = accounts.filter(
                (account) => !account.owner || account.owner === group.owner,
              )
              const groupLabel = paymentSourceLabel(group, accounts)

              return (
                <tbody className="border-t border-zinc-200" key={group.key}>
                  <tr className="bg-zinc-100/80">
                    <th className="p-0" colSpan={8}>
                      <div className="flex min-h-16 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
                        <GroupSelectionCheckbox
                          itemIds={group.items.map((item) => item.id)}
                          label={groupLabel}
                          onToggle={toggleItems}
                          selected={selected}
                        />
                        <button
                          aria-expanded={expanded}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                          onClick={() => toggleSource(group.key)}
                          type="button"
                        >
                          <span aria-hidden="true" className="w-4 shrink-0 text-center text-sm text-zinc-500">
                            {expanded ? '▾' : '▸'}
                          </span>
                          <span className="truncate font-semibold text-zinc-900" title={groupLabel}>
                            {groupLabel}
                          </span>
                          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-zinc-600">
                            {group.items.length}건
                          </span>
                          {duplicateCount > 0 && (
                            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                              중복 의심 {duplicateCount}건
                            </span>
                          )}
                          <span className="ml-auto hidden whitespace-nowrap text-xs font-normal text-zinc-500 xl:inline">
                            선택 {selectedItems.length}/{group.items.length}건 · {selectedAmount >= 0 ? '+' : '−'}
                            {Math.abs(selectedAmount).toLocaleString('ko-KR')}원
                          </span>
                        </button>
                        <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-zinc-600">
                          그룹 결제수단
                          <select
                            aria-label={`${groupLabel} 그룹 결제수단`}
                            className="w-52 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-normal text-zinc-700"
                            onChange={(event) => setSourceAccount(
                              group.items.map((item) => item.id),
                              event.target.value,
                            )}
                            value={groupAccountId}
                          >
                            <option value="">{groupAccountIds.length > 1 ? '여러 카드 선택됨' : '선택 안 함'}</option>
                            {groupAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}{account.owner ? ` · ${account.owner}` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </th>
                  </tr>
                  {expanded && group.items.map((item) => {
                    const flow = flows[item.id]
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
                        name="ids"
                        onChange={() => toggle(item.id)}
                        type="checkbox"
                        value={item.id}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{item.date}</td>
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
                      {visibleSourceCategories(item)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700"
                          name={`flow_${item.id}`}
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
                        name={`account_${item.id}`}
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
                  </tr>
                    )
                  })}
                </tbody>
              )
                })}
              </Fragment>
            ))}
          </table>
        </div>
      </div>

      <div className="mt-3">
        <ActionButtons selectedCount={selected.size} />
      </div>
      </form>
      </section>
      ) : highItems.length > 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center">
          <p className="font-medium text-emerald-900">직접 확인할 거래가 없습니다.</p>
          <p className="mt-2 text-sm text-emerald-700">위 자동 분류 항목을 펼쳐 검토하거나 한 번에 승인할 수 있습니다.</p>
        </div>
      ) : null}
    </>
  )
}
