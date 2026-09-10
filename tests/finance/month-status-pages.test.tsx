import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { evaluateBudget } from '@/features/budget-recommendations/calculations'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

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
  useRouter: () => ({ refresh: vi.fn() }),
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
      baselines: [],
      targetVersion: 'target-version',
      averageIncome: 0,
      averageExpense: 0,
      averageSaving: 0,
      currentSavingsRate: 0,
      spendCeiling: 0,
      basis: { averageIncome: 0, savingsTarget: 30, spendCeiling: 0, incomeStart: '2026-01-01', incomeEnd: '2026-09-01', incomeMonthCount: 0 },
      savedRecommendations: [],
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
    const payload = html.match(/name="payload"[^>]*value="([^"]*)"/)?.[1]
    expect(payload).toBeDefined()
    expect(JSON.parse(payload!.replaceAll('&quot;', '"'))).toEqual({
      month: '2026-09', changes: [], targetChange: null, acknowledgeOverage: false,
    })
  })

  test('the page passes canonical actuals and historical saved reasons into one budget editor', async () => {
    const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const snapshot = makeBudgetSnapshot()
    const report = makeBudgetReport()
    report.rows[0].reason = '저장 당시의 식비 추천 근거입니다.'
    loaders.budget.mockResolvedValue({
      month: '2026-09', previousMonth: '2026-08', nextMonth: '2026-10',
      rows: [{ major: '식비', group: 'variable', budget: 350_000, previousBudget: 330_000,
        actual: 100_000, average: 300_000, remaining: 250_000, percent: 28.6 }],
      totalBudget: 350_000, totalActual: 100_000, remaining: 250_000,
      savingsTarget: 30,
      baselines: [{ major: '식비', amount: 350_000, recommendationJobId: jobId, version: 'food-v1' }],
      targetVersion: 'target-version', averageIncome: 1_000_000, averageExpense: 300_000,
      averageSaving: 100_000, currentSavingsRate: 60, spendCeiling: 700_000,
      basis: snapshot.basis,
      savedRecommendations: [{ id: jobId, completedAt: '2026-09-10T00:00:00.000Z', snapshot,
        promptInput: null, report, evaluation: evaluateBudget(snapshot, report.rows) }],
      paceWarnings: [], nextBudgetExists: false,
      review: { reviewMonth: '2026-08', rows: [], reviewIncome: 0, reviewExpense: 0,
        reviewSaving: 0, reviewSavingsRate: 0, reviewBudgetTotal: 0 },
    })

    const html = renderToStaticMarkup(await BudgetsPage({ searchParams: Promise.resolve({ month: '2026-09' }) }))

    expect(html.match(/aria-label="식비 예산"/g)).toHaveLength(1)
    expect(html).toContain('실제 지출 −100,000원')
    expect(html).toContain('저장 당시의 식비 추천 근거입니다.')
    expect(html).toContain('원래 AI 추천 300,000원')
  })

  test('the legacy review page permanently redirects to the same target month', async () => {
    await BudgetReviewPage({ searchParams: Promise.resolve({ month: '2026-09' }) })
    expect(loaders.permanentRedirect).toHaveBeenCalledWith('/budgets?month=2026-09')
  })
})
