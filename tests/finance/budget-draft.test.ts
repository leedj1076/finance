import { describe, expect, test } from 'vitest'
import { budgetDraftReducer, createBudgetDraft, draftBudgetAmounts, draftBudgetChanges } from '@/features/budgets/draft'
import type { BudgetBaseline } from '@/features/budgets/save-contract'
import type { BudgetPlanRow } from '@/features/budgets/plan-sources'
const job = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const baseline = (): BudgetBaseline[] => [
  { major: '식비', amount: 350000, recommendationJobId: null, version: 'food-v1' },
  { major: '교통', amount: 90000, recommendationJobId: null, version: 'travel-v1' },
]
const plan = (): BudgetPlanRow[] => baseline().map(saved => ({ major: saved.major, saved, group: 'variable', actual: 0,
  previousBudget: saved.amount, previousActual: { amount: saved.amount, month: '2026-08', partial: null },
  average3: { amount: 100000, months: ['2026-08'], monthsWithSpend: 1, provisional: true } }))

test('initial sources describe the saved values and do not cause changes', () => {
  const state = createBudgetDraft(baseline(), plan(), null)
  expect(state.rows.map(row => row.source)).toEqual(['previousBudget', 'previousBudget'])
  expect(draftBudgetChanges(state)).toEqual([])
  expect('selected' in state).toBe(false)
})
test('initial AI needs matching provenance and recommendation amount', () => {
  const rows = baseline(); rows[0].recommendationJobId = job
  expect(createBudgetDraft(rows, plan(), job, { 식비: 350000 }).rows[0].source).toBe('ai')
  expect(createBudgetDraft(rows, plan(), job, { 식비: 340000 }).rows[0].source).toBe('previousBudget')
})
test('choose changes one row and edit retains AI provenance while clearing selection', () => {
  let state = createBudgetDraft(baseline())
  state = budgetDraftReducer(state, { type: 'choose', major: '식비', amount: 300000, source: 'ai', recommendationJobId: job })
  expect(state.rows[0]).toEqual({ major: '식비', amount: '300000', source: 'ai', recommendationJobId: job })
  expect(state.rows[1].amount).toBe('90000')
  state = budgetDraftReducer(state, { type: 'edit', major: '식비', amount: '310000' })
  expect(state.rows[0]).toMatchObject({ amount: '310000', source: null, recommendationJobId: job })
  expect(draftBudgetChanges(state)[0]).toEqual({ major: '식비', amount: 310000, recommendationJobId: job, expectedVersion: 'food-v1' })
})
test.each(['previousBudget', 'previousActual', 'average3'] as const)('%s choice clears provenance even with a caller ID', source => {
  const rows = baseline(); rows[0].recommendationJobId = job
  const state = budgetDraftReducer(createBudgetDraft(rows), { type: 'choose', major: '식비', amount: 350000, source, recommendationJobId: job })
  expect(state.rows[0].recommendationJobId).toBeNull()
  expect(draftBudgetChanges(state)[0]).toMatchObject({ amount: 350000, recommendationJobId: null })
})
test('fill snapshots amounts and sources for one undo only', () => {
  let state = budgetDraftReducer(createBudgetDraft(baseline(), plan()), { type: 'choose', major: '식비', amount: 300000, source: 'ai', recommendationJobId: job })
  const before = structuredClone(state.rows)
  state = budgetDraftReducer(state, { type: 'fill', choices: [{ major: '식비', amount: 320000, source: 'previousActual', recommendationJobId: null }] })
  expect(state.rows[0]).toMatchObject({ amount: '320000', source: 'previousActual', recommendationJobId: null })
  expect(state.undoRows).toEqual(before)
  state = budgetDraftReducer(state, { type: 'undo' })
  expect(state.rows).toEqual(before)
  expect(state.undoRows).toBeNull()
  expect(budgetDraftReducer(state, { type: 'undo' })).toBe(state)
})
test('source-only choice is not a persistence change', () => {
  const state = budgetDraftReducer(createBudgetDraft(baseline()), { type: 'choose', major: '식비', amount: 350000, source: 'previousActual', recommendationJobId: null })
  expect(draftBudgetChanges(state)).toEqual([])
})
test('rebase preserves dirty invalid input and provenance, adopts clean rows and new versions', () => {
  const rows = baseline(); rows[1].recommendationJobId = job
  let state = budgetDraftReducer(createBudgetDraft(rows), { type: 'edit', major: '식비', amount: '' })
  state = budgetDraftReducer(state, { type: 'choose', major: '교통', amount: 90000, source: 'previousBudget', recommendationJobId: null })
  const fresh = [...baseline().map(row => ({ ...row, amount: row.amount + 1000, version: 'v2' })), { major: '주거', amount: 500000, recommendationJobId: null, version: 'v1' }]
  state = budgetDraftReducer(state, { type: 'rebase', rows: fresh })
  fresh[0].amount = 1
  expect(state.rows.map(row => row.amount)).toEqual(['', '90000', '500000'])
  expect(state.baseline[0].amount).toBe(351000)
  expect(state.rows[1].recommendationJobId).toBeNull()
  expect(() => draftBudgetChanges(state)).toThrow('invalid_amount')
})
test.each(['350000', '0350000', ' 350000 '])('rebase treats equivalent %j as clean', amount => {
  let state = budgetDraftReducer(createBudgetDraft(baseline()), { type: 'edit', major: '식비', amount })
  state = budgetDraftReducer(state, { type: 'rebase', rows: baseline().map(row => ({ ...row, amount: row.amount + 1 })) })
  expect(state.rows[0].amount).toBe('350001')
  expect(draftBudgetChanges(state)).toEqual([])
})
describe('serialization', () => {
  test.each(['', ' ', '-1', '1.5', 'NaN', '9007199254740992'])('rejects %j', amount => {
    const state = budgetDraftReducer(createBudgetDraft(baseline()), { type: 'edit', major: '식비', amount })
    expect(() => draftBudgetAmounts(state)).toThrow('invalid_amount')
    expect(() => draftBudgetChanges(state)).toThrow('invalid_amount')
  })
  test('acknowledgement adopts server versions, preserves matching session source, and clears undo', () => {
    let state = budgetDraftReducer(createBudgetDraft(baseline()), { type: 'fill', choices: [{ major: '식비', amount: 300000, source: 'ai', recommendationJobId: job }] })
    const rows = [{ ...baseline()[0], amount: 300000, recommendationJobId: job, version: 'v2' }, baseline()[1]]
    state = budgetDraftReducer(state, { type: 'saved', rows })
    rows[0].amount = 1
    expect(state.rows[0]).toMatchObject({ amount: '300000', source: 'ai', recommendationJobId: job })
    expect(state.baseline[0].version).toBe('v2')
    expect(state.undoRows).toBeNull()
    expect(draftBudgetChanges(state)).toEqual([])
  })
})
