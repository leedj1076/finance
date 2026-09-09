import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const loaders = vi.hoisted(() => ({
  budget: vi.fn(),
  review: vi.fn(),
  statuses: vi.fn(),
}))

vi.mock('@/lib/household', () => ({
  getAuthContext: async () => ({ email: 'test@example.com' }),
  requireHousehold: async () => ({ householdId: 'household-a', email: 'test@example.com' }),
}))
vi.mock('@/components/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/features/budgets/queries', () => ({ getBudgetData: loaders.budget }))
vi.mock('@/features/budgets/review-queries', () => ({ getBudgetReviewData: loaders.review }))
vi.mock('@/features/month-close/queries', () => ({ getMonthStatuses: loaders.statuses }))

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
    })

    const html = renderToStaticMarkup(await BudgetsPage({ searchParams: Promise.resolve({ month: '2026-09' }) }))
    const heading = html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1] ?? ''

    expect(heading).toContain('2026년 09월 예산')
    expect(heading).toContain('2026년 9월 · 진행 중 · 9일 경과 / 30일')
    expect(html).not.toContain('실제 사용액은 마감 전 내역도 포함합니다')
    expect(html).not.toContain('예산의 평균·제안에는 잠정 내역이 포함될 수 있습니다')
  })

  test('the review month status renders inside the heading without a separate live-data sentence or raw text sizes', async () => {
    loaders.review.mockResolvedValue({
      reviewMonth: '2026-08',
      targetMonth: '2026-09',
      rows: [],
      reviewIncome: 3_000_000,
      reviewExpense: 2_000_000,
      reviewSavingsRate: 33.3,
      reviewBudgetTotal: 2_100_000,
      existingCount: 0,
      averageIncome: 3_000_000,
      savingsTarget: 30,
      spendCeiling: 2_100_000,
    })

    const html = renderToStaticMarkup(await BudgetReviewPage({ searchParams: Promise.resolve({ month: '2026-09' }) }))
    const heading = html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1] ?? ''

    expect(heading).toContain('월말 리뷰')
    expect(heading).toContain('2026년 8월 · 미마감 · 잠정')
    expect(html).not.toContain('예산 제안은 미마감 내역도 포함한 실시간 기준입니다')
    expect(html).not.toContain('다음 달 예산 작성과 이번 달 마감은 별개입니다')
    expect(html).not.toMatch(/text-\[\d+px\]/)
  })
})
