'use client'

import { useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'

import type { TransactionFlow } from './banksalad'
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
  return accountName ?? group.pay ?? '결제 소스 미상'
}

export function visibleSourceCategories(item: Pick<InboxItem, 'bsCat1' | 'bsCat2'>) {
  return [item.bsCat1, item.bsCat2]
    .filter((value): value is string => value !== null && value !== '' && !value.startsWith('__source:'))
    .join(' / ') || '-'
}

const sourceStyle: Record<string, { label: string; className: string }> = {
  user: { label: '캐시', className: 'bg-finance-green-tint text-finance-green' },
  history: { label: '이력', className: 'bg-finance-blue-tint text-finance-blue' },
  ai: { label: 'AI', className: 'bg-finance-violet-tint text-finance-violet' },
  banksalad: { label: '뱅샐', className: 'bg-finance-amber-tint text-finance-amber' },
}

export function SuggestionBadges({ item }: { item: InboxItem }) {
  const source = item.sugSource ? sourceStyle[item.sugSource] : null
  const evidence = [item.businessType, item.aiNote].filter(Boolean).join(' · ')
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {source && (
        <span
          className={`shrink-0 px-1.5 py-1 text-[10px] font-semibold ${source.className}`}
          title={evidence || undefined}
        >
          {source.label}
        </span>
      )}
      {item.alwaysConfirm && (
        <span
          className="shrink-0 bg-finance-amber-tint px-1.5 py-1 text-[10px] font-semibold text-finance-amber"
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
        className="h-[34px] border border-finance-border bg-white px-4 text-[13px] font-medium text-finance-muted hover:border-finance-ink hover:text-finance-ink disabled:opacity-40"
        disabled={pending || selectedCount === 0}
        name="intent"
        type="submit"
        value="dismiss"
      >
        {pending ? '처리 중…' : '선택 제외'}
      </button>
      <button
        className="h-[34px] bg-finance-green px-4 text-[13px] font-semibold text-white hover:bg-finance-ink disabled:opacity-40"
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
      className="h-4 w-4 shrink-0 accent-finance-ink"
      onChange={() => onToggle(itemIds, !allSelected)}
      ref={inputRef}
      type="checkbox"
    />
  )
}
