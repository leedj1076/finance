'use client'

import type { InboxPaymentSourceGroup } from './grouping'
import { GroupSelectionCheckbox, paymentSourceLabel } from './inbox-review-shared'
import { InboxItemRow, type InboxRowState } from './inbox-review-item-row'
import type { AccountOption, InboxItem } from './inbox-review-types'

export function InboxSourceGroup({
  group,
  expanded,
  toggleSource,
  selected,
  toggleItems,
  accounts,
  setSourceAccount,
  rowState,
}: {
  group: InboxPaymentSourceGroup<InboxItem>
  expanded: boolean
  toggleSource: (key: string) => void
  selected: Set<number>
  toggleItems: (itemIds: number[], select: boolean) => void
  accounts: AccountOption[]
  setSourceAccount: (itemIds: number[], accountId: string) => void
  rowState: InboxRowState
}) {
  const { flows } = rowState
  const selectedItems = group.items.filter((item) => selected.has(item.id))
  const selectedAmount = selectedItems.reduce(
    (total, item) => total + (flows[item.id] === 'income' ? item.amount : -item.amount),
    0,
  )
  const duplicateCount = group.items.filter((item) => item.dupNote).length
  const groupAccountIds = [...new Set(group.items.map((item) => rowState.accountIds[item.id] ?? ''))]
  const groupAccountId = groupAccountIds.length === 1 ? groupAccountIds[0] : ''
  const groupAccounts = accounts.filter(
    (account) => !account.owner || account.owner === group.owner,
  )
  const groupLabel = paymentSourceLabel(group, accounts)

  return (
    <tbody className="border-t border-finance-border" key={group.key}>
      <tr className="bg-finance-panel">
        <th className="p-0" colSpan={8}>
          <div className="flex min-h-16 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:pl-10">
            <GroupSelectionCheckbox
              itemIds={group.items.map((item) => item.id)}
              label={groupLabel}
              onToggle={toggleItems}
              selected={selected}
            />
            <button
              aria-expanded={expanded}
              className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-finance-blue"
              onClick={() => toggleSource(group.key)}
              type="button"
            >
              <span aria-hidden="true" className="w-4 shrink-0 text-center t-body text-finance-muted">
                {expanded ? '▾' : '▸'}
              </span>
              <span className="truncate font-semibold text-finance-ink" title={groupLabel}>
                {groupLabel}
              </span>
              <span className="shrink-0 bg-white px-2 py-0.5 text-[10px] font-semibold text-finance-muted">
                {group.items.length}건
              </span>
              {duplicateCount > 0 && (
                <span className="shrink-0 bg-finance-red-tint px-2 py-0.5 text-[10px] font-semibold text-finance-red">
                  중복 의심 {duplicateCount}건
                </span>
              )}
              <span className="ml-auto hidden whitespace-nowrap t-caption font-normal text-finance-muted xl:inline">
                선택 {selectedItems.length}/{group.items.length}건 · {selectedAmount >= 0 ? '+' : '−'}
                {Math.abs(selectedAmount).toLocaleString('ko-KR')}원
              </span>
            </button>
            <label className="flex shrink-0 items-center gap-2 t-caption font-medium text-finance-muted">
              그룹 결제수단
              <select
                aria-label={`${groupLabel} 그룹 결제수단`}
                className="h-[30px] w-52 border border-finance-border bg-white px-2 t-caption font-normal text-finance-ink outline-none focus:border-finance-blue"
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
      {expanded && group.items.map((item) => (
        <InboxItemRow item={item} key={item.id} rowState={rowState} />
      ))}
    </tbody>
  )
}
