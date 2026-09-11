import { expect, test } from 'vitest'
import { budgetDraftReducer, createBudgetDraft } from '@/features/budgets/draft'
import { overwrittenDraftRows } from '@/features/budgets/plan-fill'
const baseline = [{ major: '식비', amount: 350000, recommendationJobId: null, version: 'v1' }]
const choices = [{ major: '식비', amount: 300000, source: 'previousActual' as const, recommendationJobId: null }]
test('only dirty rows whose amount or origin would change require confirmation', () => {
  let draft = createBudgetDraft(baseline)
  expect(overwrittenDraftRows(draft, choices)).toEqual([])
  draft = budgetDraftReducer(draft, { type: 'edit', major: '식비', amount: '310000' })
  expect(overwrittenDraftRows(draft, choices).map(row => row.major)).toEqual(['식비'])
  expect(overwrittenDraftRows(draft, [{ ...choices[0], amount: 310000 }])).toEqual([])
  draft = budgetDraftReducer(draft, { type: 'edit', major: '식비', amount: '' })
  expect(overwrittenDraftRows(draft, choices)).toHaveLength(1)
})
test('provenance-only changes are dirty while source-only changes are not', () => {
  const draft = budgetDraftReducer(createBudgetDraft(baseline), { type: 'choose', major: '식비', amount: 350000, source: 'ai', recommendationJobId: 'job' })
  expect(overwrittenDraftRows(draft, choices)).toHaveLength(1)
  const clean = budgetDraftReducer(createBudgetDraft(baseline), { type: 'choose', major: '식비', amount: 350000, source: 'previousBudget', recommendationJobId: null })
  expect(overwrittenDraftRows(clean, choices)).toEqual([])
})
