'use client'

import { Fragment } from 'react'

import type { InboxMonthOwnerPaymentSourceGroup } from './grouping'
import { formatInboxMonth } from './grouping'
import { GroupSelectionCheckbox } from './inbox-review-shared'
import type { InboxRowState } from './inbox-review-item-row'
import { InboxOwnerGroup } from './inbox-review-owner-group'
import type { AccountOption, InboxItem } from './inbox-review-types'

export function InboxMonthGroup({
  monthGroup,
  monthExpanded,
  toggleMonth,
  selected,
  toggleItems,
  expandedOwners,
  toggleOwner,
  expandedSources,
  toggleSource,
  accounts,
  setSourceAccount,
  rowState,
}: {
  monthGroup: InboxMonthOwnerPaymentSourceGroup<InboxItem>
  monthExpanded: boolean
  toggleMonth: (month: string) => void
  selected: Set<number>
  toggleItems: (itemIds: number[], select: boolean) => void
  expandedOwners: Set<string>
  toggleOwner: (key: string) => void
  expandedSources: Set<string>
  toggleSource: (key: string) => void
  accounts: AccountOption[]
  setSourceAccount: (itemIds: number[], accountId: string) => void
  rowState: InboxRowState
}) {
  return (
    <Fragment key={monthGroup.month}>
      <tbody className="border-t border-finance-ink first:border-t-0">
        <tr className="bg-finance-ink text-white">
          <th className="p-0" colSpan={8}>
            <div className="flex min-h-14 items-center gap-3 px-4 py-3">
              <GroupSelectionCheckbox
                itemIds={monthGroup.items.map((item) => item.id)}
                label={formatInboxMonth(monthGroup.month)}
                onToggle={toggleItems}
                selected={selected}
              />
              <button
                aria-expanded={monthExpanded}
                className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={() => toggleMonth(monthGroup.month)}
                type="button"
              >
                <span aria-hidden="true" className="w-4 shrink-0 text-center t-body text-finance-faint">
                  {monthExpanded ? '▾' : '▸'}
                </span>
                <span className="font-bold">{formatInboxMonth(monthGroup.month)}</span>
                <span className="bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-finance-faint">
                  {monthGroup.items.length}건
                </span>
                <span className="ml-auto t-caption font-normal text-finance-faint">
                  사람 {monthGroup.owners.length}명 · 결제수단 {monthGroup.owners.reduce((total, owner) => total + owner.sources.length, 0)}개
                </span>
              </button>
            </div>
          </th>
        </tr>
      </tbody>
      {monthExpanded && monthGroup.owners.map((ownerGroup) => (
        <InboxOwnerGroup
          accounts={accounts}
          expanded={expandedOwners.has(ownerGroup.key)}
          expandedSources={expandedSources}
          group={ownerGroup}
          key={ownerGroup.key}
          rowState={rowState}
          selected={selected}
          setSourceAccount={setSourceAccount}
          toggleItems={toggleItems}
          toggleOwner={toggleOwner}
          toggleSource={toggleSource}
        />
      ))}
    </Fragment>
  )
}
