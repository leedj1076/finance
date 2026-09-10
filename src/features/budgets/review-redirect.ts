import { currentMonthInKorea, isMonthKey } from '@/lib/finance'

export function budgetReviewDestination(month: unknown): string {
  const target = typeof month === 'string' && isMonthKey(month)
    ? month
    : currentMonthInKorea()
  return `/budgets?month=${target}`
}
