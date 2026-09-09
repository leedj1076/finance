import { describe, expect, test } from 'vitest'

import type { MonthCloseSummary } from '@/features/month-close/state'
import { wrapUpSteps } from '@/features/month-close/wrap-up'

function summary(overrides: Partial<MonthCloseSummary> = {}): MonthCloseSummary {
  return {
    month: '2026-08', revision: 3, closedRevision: null, closedAt: null, state: 'open',
    count: 187, income: 5_400_000, expense: 3_812_400, saving: 700_000,
    pendingCount: 0, unclassifiedCount: 5, unpostedRecurringCount: 0,
    closable: true, requiresAcknowledgment: true,
    ...overrides,
  }
}

describe('wrapUpSteps', () => {
  test('lists the three clean-up items with counts and marks the empty ones done', () => {
    const model = wrapUpSteps(summary())
    expect(model.visible).toBe(true)
    expect(model.steps.map((step) => [step.key, step.count, step.done])).toEqual([
      ['inbox', 0, true],
      ['recurring', 0, true],
      ['unclassified', 5, false],
    ])
    expect(model.doneCount).toBe(2)
    expect(model.allClear).toBe(false)
    expect(model.steps[2].href).toBe('/inbox?tab=unclassified')
    expect(model.steps[1].href).toBeNull()
  })

  test('collapses to all clear when every count is zero', () => {
    const model = wrapUpSteps(summary({ unclassifiedCount: 0, requiresAcknowledgment: false }))
    expect(model.allClear).toBe(true)
    expect(model.doneCount).toBe(3)
  })

  test('is hidden for the current month, closed months and months needing review', () => {
    expect(wrapUpSteps(summary({ closable: false })).visible).toBe(false)
    expect(wrapUpSteps(summary({ state: 'closed', closedRevision: 3, closedAt: '2026-09-02T00:00:00Z' })).visible).toBe(false)
    expect(wrapUpSteps(summary({ state: 'needs_review', closedRevision: 2, closedAt: '2026-09-02T00:00:00Z' })).visible).toBe(false)
  })
})
