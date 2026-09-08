'use client'

import Link from 'next/link'
import { createContext, useContext, useState, type ReactNode } from 'react'

export type ImportTab = 'review' | 'upload' | 'history' | 'unclassified'

const ActiveTab = createContext<ImportTab>('review')

export function InboxTabs({ requestedTab, defaultTab, pendingCount, unclassifiedCount, children }: {
  requestedTab?: ImportTab
  defaultTab: ImportTab
  pendingCount: number
  unclassifiedCount: number
  children: ReactNode
}) {
  // A mutation can change the default (last pending item processed), but only
  // navigation should change the tab the user is currently working in.
  const [initialTab] = useState(defaultTab)
  const tab = requestedTab ?? initialTab
  const tabs: Array<{ key: ImportTab; label: string; count?: number }> = [
    { key: 'review', label: '검토 대기', count: pendingCount },
    { key: 'upload', label: '파일 업로드' },
    { key: 'history', label: '처리 기록' },
    { key: 'unclassified', label: '미분류 거래', count: unclassifiedCount },
  ]

  return <ActiveTab.Provider value={tab}>
    <nav aria-label="가져오기 작업" className="mt-6 flex overflow-x-auto border-b border-finance-border">
      {tabs.map((item) => (
        <Link
          aria-current={tab === item.key ? 'page' : undefined}
          className={`shrink-0 border-b-2 px-4 py-3 t-body-strong ${tab === item.key ? 'border-finance-blue text-finance-blue' : 'border-transparent text-finance-muted hover:text-finance-ink'}`}
          href={`/inbox?tab=${item.key}`}
          key={item.key}
        >
          {item.label}{item.count !== undefined && <span className="ml-1.5 bg-finance-track px-2 py-0.5 t-badge text-finance-muted">{item.count.toLocaleString('ko-KR')}</span>}
        </Link>
      ))}
    </nav>
    {children}
  </ActiveTab.Provider>
}

export function InboxTabPanel({ tab, children }: { tab: ImportTab; children: ReactNode }) {
  return useContext(ActiveTab) === tab ? children : null
}
