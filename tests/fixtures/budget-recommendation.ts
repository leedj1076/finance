import type { BudgetRecommendationReport, BudgetRecommendationSnapshot } from '@/features/budget-recommendations/types'

export function makeBudgetSnapshot(): BudgetRecommendationSnapshot {
  return {
    version: 1, month: '2026-09', asOfDate: '2026-09-10',
    sourceHash: 'a'.repeat(64), budgetHash: 'b'.repeat(64), fingerprint: 'c'.repeat(64),
    input: { month: '2026-09', notes: '', plannedExpenses: [], draftAmounts: [] },
    basis: { averageIncome: 1_000_000, savingsTarget: 30, spendCeiling: 700_000,
      incomeStart: '2026-01-01', incomeEnd: '2026-09-01', incomeMonthCount: 8 },
    current: { income: 1_000_000, expense: 120_000, saving: 80_000,
      unallocatedActual: 20_000, unallocatedRecurring: 0 },
    rows: [{ major: '식비', group: 'variable', savedAmount: 350_000, savedRecommendationJobId: null, actual: 100_000,
      unpostedRecurring: 0, planned: 0, floor: 100_000, previousBudget: 350_000,
      previousActual: 320_000, average: 300_000, median: 300_000, subcategories: [] }],
    history: ['2026-03','2026-04','2026-05','2026-06','2026-07','2026-08'].map(month => ({
      month, state: 'closed', hasRecords: true, partial: false, income: 1_000_000,
      expense: 320_000, saving: 80_000, majors: [{ major: '식비', amount: 320_000 }],
    })),
    recurring: [],
    evidence: [{ id: 11, date: '2026-09-01', flow: 'expense', amount: 100_000,
      major: '식비', sub: '장보기', merchant: '동네마트' }],
    evidenceCount: { total: 1, provided: 1 }, pendingCount: 0, unclassifiedCount: 1,
  }
}

export function makeBudgetReport(): BudgetRecommendationReport {
  return {
    version: 1, summary: '최근 기록을 참고한 월 전체 예산입니다.', limitations: [],
    overCeilingReason: '', adjustments: [],
    rows: [{ major: '식비', amount: 300_000, reason: '기록된 장보기 비용을 포함해 배정했습니다.',
      references: [{ kind: 'transaction', id: 11 }], exceptional: [], reducible: [] }],
  }
}
