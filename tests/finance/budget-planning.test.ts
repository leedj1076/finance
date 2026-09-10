import { afterEach, expect, test, vi } from 'vitest'

const loaders = vi.hoisted(() => ({
  budget: vi.fn(),
  review: vi.fn(),
}))

vi.mock('@/features/budgets/queries', () => ({ getBudgetData: loaders.budget }))
vi.mock('@/features/budgets/review-queries', () => ({ getBudgetReviewData: loaders.review }))

import { getBudgetPlanningData } from '@/features/budgets/planning-queries'
import { budgetReviewDestination } from '@/features/budgets/review-redirect'

afterEach(() => vi.useRealTimers())

test('combined planning data keeps the budget loader ceiling and resolves review from its month', async () => {
  loaders.budget.mockResolvedValue({ month: '2026-10', spendCeiling: 2_100_000 })
  loaders.review.mockResolvedValue({ targetMonth: '2026-10', spendCeiling: 1_900_000 })

  const planning = await getBudgetPlanningData('household-a', 'invalid-month')

  expect(planning.spendCeiling).toBe(2_100_000)
  expect(planning.review.spendCeiling).toBe(1_900_000)
  expect(loaders.review).toHaveBeenCalledWith('household-a', '2026-10')
})

test('review month is already the target month', () => {
  expect(budgetReviewDestination('2026-10')).toBe('/budgets?month=2026-10')
})

test('missing or invalid review month uses current KST, not latest transaction', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-30T15:01:00Z'))
  expect(budgetReviewDestination(undefined)).toBe('/budgets?month=2026-10')
  expect(budgetReviewDestination(['2026-08'])).toBe('/budgets?month=2026-10')
})
