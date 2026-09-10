import { afterEach, expect, test, vi } from 'vitest'

const loaders = vi.hoisted(() => ({
  budget: vi.fn(),
  review: vi.fn(),
  baselines: vi.fn(),
  transaction: vi.fn(),
  reader: { select: vi.fn() },
}))

vi.mock('@/features/budgets/queries', () => ({ readBudgetData: loaders.budget }))
vi.mock('@/features/budgets/review-queries', () => ({ readBudgetReviewData: loaders.review }))
vi.mock('@/db/client', () => ({ db: { transaction: loaders.transaction } }))
vi.mock('@/features/budgets/save-service', () => ({ readBudgetBaselines: loaders.baselines }))

import { getBudgetPlanningData } from '@/features/budgets/planning-queries'
import { budgetReviewDestination } from '@/features/budgets/review-redirect'

afterEach(() => vi.useRealTimers())

test('combined planning data keeps the budget loader ceiling and resolves review from its month', async () => {
  loaders.transaction.mockImplementation(work => work(loaders.reader))
  loaders.budget.mockResolvedValue({ month: '2026-10', spendCeiling: 2_100_000 })
  loaders.review.mockResolvedValue({ targetMonth: '2026-10', spendCeiling: 1_900_000 })
  loaders.baselines.mockResolvedValue({ rows: [{ major: '식비', amount: 123, recommendationJobId: null, version: 'row-version' }], savingsTarget: 30, targetVersion: 'target-version' })

  const planning = await getBudgetPlanningData('household-a', 'invalid-month')

  expect(planning.spendCeiling).toBe(2_100_000)
  expect(planning.review.spendCeiling).toBe(1_900_000)
  expect(loaders.budget).toHaveBeenCalledWith(loaders.reader, 'household-a', 'invalid-month', expect.any(Date))
  expect(loaders.review).toHaveBeenCalledWith(loaders.reader, 'household-a', '2026-10', loaders.budget.mock.calls[0][3])
  expect(planning).toMatchObject({ baselines: [{ major: '식비', amount: 123, recommendationJobId: null, version: 'row-version' }], targetVersion: 'target-version' })
  expect(loaders.baselines).toHaveBeenCalledWith(loaders.reader, 'household-a', '2026-10')
  expect(loaders.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'repeatable read', accessMode: 'read only' })
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
