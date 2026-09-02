'use client'

import { useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'

import type { TransactionFlow } from './banksalad'
import { formatInboxPaymentSource } from './grouping'
import type { AccountOption, InboxItem } from './inbox-review-types'

export const flowLabel: Record<TransactionFlow, string> = {
  expense: '지출',
  income: '수입',
  saving: '저축',
}

export function paymentSourceLabel(
  group: { accountId: number | null; owner: string; pay: string | null },
  accounts: AccountOption[],
) {
  const accountName = group.accountId === null
    ? undefined
    : accounts.find((account) => account.id === group.accountId)?.name
  return formatInboxPaymentSource(group, accountName)
}

export function visibleSourceCategories(item: Pick<InboxItem, 'bsCat1' | 'bsCat2'>) {
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

export function SuggestionBadges({ item }: { item: InboxItem }) {
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

export function ActionButtons({ selectedCount }: { selectedCount: number }) {
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

export function GroupSelectionCheckbox({
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
