'use client'

import type { InboxOwnerPaymentSourceGroup } from './grouping'
import { GroupSelectionCheckbox } from './inbox-review-shared'
import type { InboxRowState } from './inbox-review-item-row'
import { InboxSourceGroup } from './inbox-review-source-group'
import type { AccountOption, InboxItem } from './inbox-review-types'

export function InboxOwnerGroup({
  group,
  expanded,
  toggleOwner,
  selected,
  toggleItems,
  expandedSources,
  toggleSource,
  accounts,
  setSourceAccount,
  rowState,
}: {
  group: InboxOwnerPaymentSourceGroup<InboxItem>
  expanded: boolean
  toggleOwner: (key: string) => void
  selected: Set<number>
  toggleItems: (itemIds: number[], select: boolean) => void
  expandedSources: Set<string>
  toggleSource: (key: string) => void
  accounts: AccountOption[]
  setSourceAccount: (itemIds: number[], accountId: string) => void
  rowState: InboxRowState
}) {
  const duplicateCount = group.items.filter((item) => item.dupNote).length

  return (
    <>
      <tbody className="border-t border-finance-border">
        <tr className="bg-finance-blue-tint">
          <th className="p-0" colSpan={8}>
            <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
              <GroupSelectionCheckbox
                itemIds={group.items.map((item) => item.id)}
                label={group.owner}
                onToggle={toggleItems}
                selected={selected}
              />
              <button
                aria-expanded={expanded}
                className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-finance-blue"
                onClick={() => toggleOwner(group.key)}
                type="button"
              >
                <span aria-hidden="true" className="w-4 shrink-0 text-center text-sm text-finance-blue">
                  {expanded ? '▾' : '▸'}
                </span>
                <span className="inline-flex h-7 min-w-7 items-center justify-center bg-finance-blue px-2 text-xs font-bold text-white">
                  {group.owner}
                </span>
                <span className="text-xs font-semibold text-finance-ink">{group.items.length}건</span>
                {duplicateCount > 0 && (
                  <span className="bg-finance-red-tint px-2 py-0.5 text-[10px] font-semibold text-finance-red">
                    중복 의심 {duplicateCount}건
                  </span>
                )}
                <span className="ml-auto text-xs font-normal text-finance-muted">
                  결제수단 {group.sources.length}개
                </span>
              </button>
            </div>
          </th>
        </tr>
      </tbody>
      {expanded && group.sources.map((sourceGroup) => (
        <InboxSourceGroup
          accounts={accounts}
          expanded={expandedSources.has(sourceGroup.key)}
          group={sourceGroup}
          key={sourceGroup.key}
          rowState={rowState}
          selected={selected}
          setSourceAccount={setSourceAccount}
          toggleItems={toggleItems}
          toggleSource={toggleSource}
        />
      ))}
    </>
  )
}
