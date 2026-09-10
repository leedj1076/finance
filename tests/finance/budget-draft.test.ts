import { describe, expect, test } from 'vitest'

import { evaluateBudget } from '@/features/budget-recommendations/calculations'
import type { BudgetBaseline } from '@/features/budgets/save-contract'
import {
  budgetDraftReducer,
  createBudgetDraft,
  draftBudgetAmounts,
  draftBudgetChanges,
} from '@/features/budgets/draft'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherJobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function baseline(): BudgetBaseline[] {
  return [
    { major: '식비', amount: 350_000, recommendationJobId: null, version: 'food-v1' },
    { major: '교통', amount: 90_000, recommendationJobId: null, version: 'travel-v1' },
  ]
}

function completed() {
  const snapshot = makeBudgetSnapshot()
  const report = makeBudgetReport()
  return {
    id: jobId,
    completedAt: '2026-09-10T01:00:00Z',
    snapshot,
    promptInput: null,
    report,
    evaluation: evaluateBudget(snapshot, report.rows),
  }
}

test('nothing is selected; applying one category preserves all other manual values', () => {
  let state = createBudgetDraft(baseline())
  expect(state.selected).toEqual([])
  state = budgetDraftReducer(state, { type: 'edit', major: '교통', amount: '80000' })
  state = budgetDraftReducer(state, { type: 'select', majors: ['식비'] })
  state = budgetDraftReducer(state, { type: 'apply', completed: completed() })
  expect(state.rows.map((row) => row.amount)).toEqual(['300000', '80000'])
  state = budgetDraftReducer(state, { type: 'edit', major: '식비', amount: '310000' })
  expect(draftBudgetChanges(state).find((row) => row.major === '식비')?.recommendationJobId)
    .toBe(jobId)
  state = budgetDraftReducer(state, { type: 'manual', majors: ['식비'] })
  expect(state.rows[0].recommendationJobId).toBeNull()
})

describe('draft selection and immutable row transitions', () => {
  test('selection supports one, all, and none without changing amounts', () => {
    const initial = createBudgetDraft(baseline())
    const one = budgetDraftReducer(initial, { type: 'select', majors: ['교통', '없음', '교통'] })
    const all = budgetDraftReducer(one, { type: 'select', majors: ['식비', '교통'] })
    const none = budgetDraftReducer(all, { type: 'select', majors: [] })

    expect(one.selected).toEqual(['교통'])
    expect(all.selected).toEqual(['식비', '교통'])
    expect(none.selected).toEqual([])
    expect(none.rows).toEqual(initial.rows)
    expect(one).not.toBe(initial)
    expect(initial.selected).toEqual([])
  })

  test('fill clears origin only for copied rows and undo restores amounts and origins', () => {
    const withOrigin = baseline()
    withOrigin[0].recommendationJobId = jobId
    let state = createBudgetDraft(withOrigin)
    state = budgetDraftReducer(state, { type: 'select', majors: ['식비'] })
    state = budgetDraftReducer(state, { type: 'apply', completed: completed() })
    const appliedRows = state.rows

    state = budgetDraftReducer(state, { type: 'fill', amounts: [{ major: '식비', amount: 320_000 }] })
    expect(state.rows).toEqual([
      { major: '식비', amount: '320000', recommendationJobId: null },
      { major: '교통', amount: '90000', recommendationJobId: null },
    ])
    expect(state.undoRows).toEqual(appliedRows)

    state = budgetDraftReducer(state, { type: 'undo' })
    expect(state.rows).toEqual(appliedRows)
    expect(state.rows[0].recommendationJobId).toBe(jobId)
    expect(state.undoRows).toBeNull()
  })

  test('conflict rebase retains only dirty amount or provenance and adopts every clean fresh row', () => {
    const initial = [
      { major: '식비', amount: 350_000, recommendationJobId: null, version: 'food-v1' },
      { major: '교통', amount: 90_000, recommendationJobId: jobId, version: 'travel-v1' },
      { major: '보험', amount: 100_000, recommendationJobId: null, version: 'insurance-v1' },
      { major: '삭제됨', amount: 50_000, recommendationJobId: null, version: 'removed-v1' },
    ]
    let state = createBudgetDraft(initial)
    state = budgetDraftReducer(state, { type: 'edit', major: '식비', amount: '330000' })
    state = budgetDraftReducer(state, { type: 'manual', majors: ['교통'] })
    state = budgetDraftReducer(state, { type: 'select', majors: ['식비', '교통', '보험', '삭제됨'] })
    const fresh = [
      { major: '식비', amount: 360_000, recommendationJobId: otherJobId, version: 'food-v2' },
      { major: '교통', amount: 95_000, recommendationJobId: otherJobId, version: 'travel-v2' },
      { major: '보험', amount: 120_000, recommendationJobId: otherJobId, version: 'insurance-v2' },
      { major: '주거', amount: 500_000, recommendationJobId: null, version: 'housing-v1' },
    ]

    state = budgetDraftReducer(state, { type: 'rebase', rows: fresh })
    fresh[0].amount = 1

    expect(state.rows).toEqual([
      { major: '식비', amount: '330000', recommendationJobId: null },
      { major: '교통', amount: '90000', recommendationJobId: null },
      { major: '보험', amount: '120000', recommendationJobId: otherJobId },
      { major: '주거', amount: '500000', recommendationJobId: null },
    ])
    expect(state.baseline).toEqual([
      { major: '식비', amount: 360_000, recommendationJobId: otherJobId, version: 'food-v2' },
      { major: '교통', amount: 95_000, recommendationJobId: otherJobId, version: 'travel-v2' },
      { major: '보험', amount: 120_000, recommendationJobId: otherJobId, version: 'insurance-v2' },
      { major: '주거', amount: 500_000, recommendationJobId: null, version: 'housing-v1' },
    ])
    expect(state.selected).toEqual(['식비', '교통', '보험'])
    expect(state.undoRows).toBeNull()
    expect(draftBudgetChanges(state)).toEqual([
      { major: '식비', amount: 330_000, recommendationJobId: null, expectedVersion: 'food-v2' },
      { major: '교통', amount: 90_000, recommendationJobId: null, expectedVersion: 'travel-v2' },
    ])
  })

  test.each(['350000', '0350000', ' 350000 '])('conflict rebase treats equivalent prior amount %j and provenance as clean', (equivalent) => {
    let state = createBudgetDraft(baseline())
    state = budgetDraftReducer(state, { type: 'edit', major: '식비', amount: '1' })
    state = budgetDraftReducer(state, { type: 'edit', major: '식비', amount: equivalent })

    state = budgetDraftReducer(state, { type: 'rebase', rows: [
      { major: '식비', amount: 360_000, recommendationJobId: otherJobId, version: 'food-v2' },
      { major: '교통', amount: 90_000, recommendationJobId: null, version: 'travel-v2' },
    ] })

    expect(state.rows[0]).toEqual({ major: '식비', amount: '360000', recommendationJobId: otherJobId })
    expect(draftBudgetChanges(state)).toEqual([])
  })

  test('conflict rebase retains invalid in-progress input as dirty without coercing it', () => {
    let state = createBudgetDraft(baseline())
    state = budgetDraftReducer(state, { type: 'edit', major: '식비', amount: '' })

    state = budgetDraftReducer(state, { type: 'rebase', rows: [
      { major: '식비', amount: 360_000, recommendationJobId: null, version: 'food-v2' },
      { major: '교통', amount: 90_000, recommendationJobId: null, version: 'travel-v2' },
    ] })

    expect(state.rows[0]).toEqual({ major: '식비', amount: '', recommendationJobId: null })
    expect(() => draftBudgetChanges(state)).toThrow('invalid_amount')
  })
})

describe('draft serialization', () => {
  test('returns a partial mixed total from the editable draft, not the complete AI report', () => {
    let state = createBudgetDraft(baseline())
    state = budgetDraftReducer(state, { type: 'edit', major: '교통', amount: '80000' })
    state = budgetDraftReducer(state, { type: 'select', majors: ['식비'] })
    state = budgetDraftReducer(state, { type: 'apply', completed: completed() })

    expect(draftBudgetAmounts(state)).toEqual([
      { major: '식비', amount: 300_000 },
      { major: '교통', amount: 80_000 },
    ])
    expect(draftBudgetAmounts(state).reduce((sum, row) => sum + row.amount, 0)).toBe(380_000)
    expect(draftBudgetChanges(state)).toEqual([
      { major: '식비', amount: 300_000, recommendationJobId: jobId, expectedVersion: 'food-v1' },
      { major: '교통', amount: 80_000, recommendationJobId: null, expectedVersion: 'travel-v1' },
    ])
  })

  test.each(['', ' ', '-1', '1.5', 'NaN', '9007199254740992'])('blocks invalid in-progress amount %j before submit', (amount) => {
    const state = budgetDraftReducer(createBudgetDraft(baseline()), { type: 'edit', major: '식비', amount })
    expect(() => draftBudgetAmounts(state)).toThrow('invalid_amount')
    expect(() => draftBudgetChanges(state)).toThrow('invalid_amount')
  })

  test('includes provenance-only changes with the matching baseline version', () => {
    const initial = baseline()
    initial[0].recommendationJobId = jobId
    let state = createBudgetDraft(initial)
    state = budgetDraftReducer(state, { type: 'manual', majors: ['식비'] })
    expect(draftBudgetChanges(state)).toEqual([{
      major: '식비', amount: 350_000, recommendationJobId: null, expectedVersion: 'food-v1',
    }])
  })

  test('saved is authoritative and clears local state; callers must guard acknowledgments by revision', () => {
    let state = budgetDraftReducer(createBudgetDraft(baseline()), { type: 'edit', major: '식비', amount: '999999' })
    state = budgetDraftReducer(state, { type: 'select', majors: ['식비'] })
    state = budgetDraftReducer(state, { type: 'apply', completed: completed() })

    const savedRows = [
      { major: '식비', amount: 360_000, recommendationJobId: jobId, version: 'food-v2' },
      { major: '교통', amount: 90_000, recommendationJobId: null, version: 'travel-v2' },
    ]
    const saved = budgetDraftReducer(state, { type: 'saved', rows: savedRows })
    savedRows[0].amount = 1

    expect(saved).toEqual({
      rows: [
        { major: '식비', amount: '360000', recommendationJobId: jobId },
        { major: '교통', amount: '90000', recommendationJobId: null },
      ],
      baseline: [
        { major: '식비', amount: 360_000, recommendationJobId: jobId, version: 'food-v2' },
        { major: '교통', amount: 90_000, recommendationJobId: null, version: 'travel-v2' },
      ],
      selected: [],
      undoRows: null,
    })
  })
})
