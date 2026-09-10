import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const loaders = vi.hoisted(() => ({
  budget: vi.fn(),
  statuses: vi.fn(),
  permanentRedirect: vi.fn(),
}))

vi.mock('@/lib/household', () => ({
  getAuthContext: async () => ({ email: 'test@example.com' }),
  requireHousehold: async () => ({ householdId: 'household-a', email: 'test@example.com' }),
}))
vi.mock('@/components/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/features/budgets/planning-queries', () => ({ getBudgetPlanningData: loaders.budget }))
vi.mock('@/features/month-close/queries', () => ({ getMonthStatuses: loaders.statuses }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  permanentRedirect: loaders.permanentRedirect,
}))

import BudgetsPage from '@/app/budgets/page'
import BudgetReviewPage from '@/app/budgets/review/page'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-09T00:00:00.000Z'))
  vi.clearAllMocks()
  loaders.statuses.mockImplementation(async (_householdId: string, months: string[]) => months.map((month) => ({
    month,
    revision: 1,
    closedRevision: null,
    closedAt: null,
    state: 'open' as const,
  })))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('month status page headings', () => {
  test('the current budget month renders its KST elapsed status inside the heading without a separate provisional sentence', async () => {
    loaders.budget.mockResolvedValue({
      month: '2026-09',
      previousMonth: '2026-08',
      nextMonth: '2026-10',
      rows: [],
      totalBudget: 0,
      totalActual: 0,
      remaining: 0,
      savingsTarget: 30,
      averageIncome: 0,
      averageExpense: 0,
      averageSaving: 0,
      currentSavingsRate: 0,
      spendCeiling: 0,
      paceWarnings: [],
      nextBudgetExists: false,
      review: { reviewMonth: '2026-08', rows: [], reviewIncome: 0, reviewExpense: 0, reviewSaving: 0, reviewSavingsRate: 0, reviewBudgetTotal: 0 },
    })

    const html = renderToStaticMarkup(await BudgetsPage({ searchParams: Promise.resolve({ month: '2026-09' }) }))
    const heading = html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1] ?? ''

    expect(heading).toContain('2026년 09월 예산')
    expect(heading).toContain('2026년 9월 · 진행 중 · 9일 경과 / 30일')
    expect(html).not.toContain('실제 사용액은 마감 전 내역도 포함합니다')
    expect(html).not.toContain('예산의 평균·제안에는 잠정 내역이 포함될 수 있습니다')
  })

  test('the legacy review page permanently redirects to the same target month', async () => {
    await BudgetReviewPage({ searchParams: Promise.resolve({ month: '2026-09' }) })
    expect(loaders.permanentRedirect).toHaveBeenCalledWith('/budgets?month=2026-09')
  })
})
