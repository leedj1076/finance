import type { AnalyticsFlow } from './calculations'

export type CategoryLinkPeriod =
  | { month: string }
  | { year: number }

type CategoryLinkOptions = {
  flow: AnalyticsFlow
  major: string
  period: CategoryLinkPeriod
  accountId?: number | null
}

export function categoryPageUrl({
  flow,
  major,
  period,
  accountId,
}: CategoryLinkOptions) {
  const params = new URLSearchParams()
  if ('month' in period) {
    params.set('month', period.month)
    params.set('tab', 'categories')
  } else {
    params.set('year', String(period.year))
  }
  params.set('flow', flow)
  params.set('major', major)
  if (typeof accountId === 'number' && Number.isSafeInteger(accountId) && accountId > 0) {
    params.set('account', String(accountId))
  }
  return 'month' in period
    ? `/ledger?${params.toString()}`
    : `/report?${params.toString()}#category-detail`
}

export function categoryAnalysisUrl({
  flow,
  period,
  accountId,
}: Omit<CategoryLinkOptions, 'major'>) {
  const params = new URLSearchParams()
  if ('month' in period) {
    params.set('month', period.month)
    params.set('tab', 'summary')
    params.set('flow', flow)
  } else {
    params.set('year', String(period.year))
  }
  if (typeof accountId === 'number' && Number.isSafeInteger(accountId) && accountId > 0) {
    params.set('account', String(accountId))
  }
  return 'month' in period ? `/ledger?${params.toString()}` : `/report?${params.toString()}`
}
