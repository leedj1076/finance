import { expect, test } from 'vitest'

import { evaluateBudget } from '@/features/budget-recommendations/calculations'
import type { BudgetRecommendationData } from '@/features/budget-recommendations/types'
import { createBudgetDraft } from '@/features/budgets/draft'
import {
  initialRecommendationSourceChoices,
  verifiedRecommendationChoices,
} from '@/features/budgets/use-plan-recommendations'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function completed(amount = 300_000) {
  const snapshot = makeBudgetSnapshot()
  const report = makeBudgetReport()
  report.rows = [{ ...report.rows[0], major: '식비', amount }]
  return {
    id: jobId,
    requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    completedAt: '2026-09-10T00:00:00Z',
    snapshot,
    promptInput: null,
    report,
    evaluation: evaluateBudget(snapshot, report.rows),
  }
}

function recommendationData(overrides: Partial<BudgetRecommendationData> = {}): BudgetRecommendationData {
  return {
    month: '2026-09',
    latestJob: { id: jobId, status: 'completed', errorCode: null },
    completed: completed(),
    worker: 'ready',
    availability: 'available',
    freshness: 'current',
    instructionsChanged: false,
    ...overrides,
  }
}

test('checked AI choices use only returned verified amounts and the exact current job', () => {
  const verified = completed(612_400)

  expect(verifiedRecommendationChoices(verified, ['식비'], {
    requestedJobId: jobId,
    data: recommendationData(),
    targetDirty: false,
  })).toEqual([{
    major: '식비', amount: 612_400, source: 'ai', recommendationJobId: jobId,
  }])

  expect(() => verifiedRecommendationChoices({ ...verified, id: 'wrong-job' }, ['식비'], {
    requestedJobId: jobId,
    data: recommendationData(),
    targetDirty: false,
  })).toThrow('invalid_result')
  expect(() => verifiedRecommendationChoices(verified, ['식비'], {
    requestedJobId: jobId,
    data: recommendationData({ latestJob: { id: 'new-job', status: 'running', errorCode: null } }),
    targetDirty: false,
  })).toThrow('recommendation_unavailable')
  expect(() => verifiedRecommendationChoices(verified, ['식비'], {
    requestedJobId: jobId,
    data: recommendationData({ freshness: 'budgets_changed' }),
    targetDirty: false,
  })).toThrow('budgets_changed')
})

test('initial recommendation hydration changes display source only for untouched exact saved origins', () => {
  const baseline = [
    { major: '식비', amount: 300_000, recommendationJobId: jobId, version: 'food-v1' },
    { major: '교통', amount: 90_000, recommendationJobId: jobId, version: 'transport-v1' },
  ]
  const draft = createBudgetDraft(baseline)
  const verified = completed(300_000)
  verified.report.rows.push({ ...verified.report.rows[0], major: '교통', amount: 90_000 })

  expect(initialRecommendationSourceChoices(draft, verified, new Set(['교통']))).toEqual([{
    major: '식비', amount: 300_000, source: 'ai', recommendationJobId: jobId,
  }])

  draft.rows[0].amount = '299999'
  expect(initialRecommendationSourceChoices(draft, verified, new Set())).toEqual([{
    major: '교통', amount: 90_000, source: 'ai', recommendationJobId: jobId,
  }])
})
