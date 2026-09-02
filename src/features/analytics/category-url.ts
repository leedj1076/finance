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
  const params = new URLSearchParams({ flow, major })
  if ('month' in period) params.set('ym', period.month)
  else params.set('year', String(period.year))
  if (typeof accountId === 'number' && Number.isSafeInteger(accountId) && accountId > 0) {
    params.set('account', String(accountId))
  }
  return `/category?${params.toString()}`
}

export function categoryAnalysisUrl({
  flow,
  period,
  accountId,
}: Omit<CategoryLinkOptions, 'major'>) {
  const params = new URLSearchParams({
    period: 'month' in period ? 'month' : 'year',
    flow,
  })
  if ('month' in period) params.set('month', period.month)
  else params.set('year', String(period.year))
  if (typeof accountId === 'number' && Number.isSafeInteger(accountId) && accountId > 0) {
    params.set('account', String(accountId))
  }
  return `/analysis?${params.toString()}`
}
