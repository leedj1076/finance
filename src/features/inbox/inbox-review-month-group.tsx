'use client'

import { Fragment } from 'react'

import type { InboxMonthPaymentSourceGroup } from './grouping'
import { formatInboxMonth } from './grouping'
import { GroupSelectionCheckbox } from './inbox-review-shared'
import type { InboxRowState } from './inbox-review-item-row'
import { InboxSourceGroup } from './inbox-review-source-group'
import type { AccountOption, InboxItem } from './inbox-review-types'

export function InboxMonthGroup({
  monthGroup,
  monthExpanded,
  toggleMonth,
  selected,
  toggleItems,
  expandedSources,
  toggleSource,
  accounts,
  setSourceAccount,
  rowState,
}: {
  monthGroup: InboxMonthPaymentSourceGroup<InboxItem>
  monthExpanded: boolean
  toggleMonth: (month: string) => void
  selected: Set<number>
  toggleItems: (itemIds: number[], select: boolean) => void
  expandedSources: Set<string>
  toggleSource: (key: string) => void
  accounts: AccountOption[]
  setSourceAccount: (itemIds: number[], accountId: string) => void
  rowState: InboxRowState
}) {
  return (
    <Fragment key={monthGroup.month}>
      <tbody className="border-t border-zinc-300 first:border-t-0">
        <tr className="bg-zinc-800 text-white">
          <th className="p-0" colSpan={9}>
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
                <span aria-hidden="true" className="w-4 shrink-0 text-center text-sm text-zinc-300">
                  {monthExpanded ? '▾' : '▸'}
                </span>
                <span className="font-bold">{formatInboxMonth(monthGroup.month)}</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium text-zinc-100">
                  {monthGroup.items.length}건
                </span>
                <span className="ml-auto text-xs font-normal text-zinc-300">
                  결제수단 {monthGroup.sources.length}개
                </span>
              </button>
            </div>
          </th>
        </tr>
      </tbody>
      {monthExpanded && monthGroup.sources.map((group) => (
        <InboxSourceGroup
          accounts={accounts}
          expanded={expandedSources.has(group.key)}
          group={group}
          key={group.key}
          rowState={rowState}
          selected={selected}
          setSourceAccount={setSourceAccount}
          toggleItems={toggleItems}
          toggleSource={toggleSource}
        />
      ))}
    </Fragment>
  )
}
