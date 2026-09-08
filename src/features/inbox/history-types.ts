export type InboxHistoryStatus = 'pending' | 'done' | 'dismissed'
export type InboxHistoryFilter = InboxHistoryStatus | 'all'

export type InboxHistoryKey = { source: string; processedOn: string }
export type InboxHistoryEntry = InboxHistoryKey & {
  label: string
  pending: number
  done: number
  dismissed: number
  earliestMonth: string
  latestMonth: string
}

export type InboxHistoryRequest = InboxHistoryKey & {
  status: InboxHistoryFilter
  page: number
}

export type InboxHistoryItem = {
  id: number
  owner: string
  date: string
  merchant: string | null
  amount: number
  flow: 'expense' | 'income' | 'saving'
  status: InboxHistoryStatus
  accountName: string | null
  categoryMajor: string | null
  categorySub: string | null
  dupNote: string | null
  canRestore: boolean
}

export type InboxHistoryPage = {
  items: InboxHistoryItem[]
  total: number
  page: number
  pageSize: number
}
