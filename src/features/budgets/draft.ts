import type { CompletedBudgetRecommendation } from '@/features/budget-recommendations/types'

import type { BudgetBaseline, BudgetSaveRequest } from './save-contract'

export type BudgetDraftRow = {
  major: string
  amount: string
  recommendationJobId: string | null
}

export type BudgetDraft = {
  rows: BudgetDraftRow[]
  baseline: BudgetBaseline[]
  selected: string[]
  undoRows: BudgetDraftRow[] | null
}

export type BudgetDraftAction =
  | { type: 'edit'; major: string; amount: string }
  | { type: 'select'; majors: string[] }
  | { type: 'apply'; completed: CompletedBudgetRecommendation }
  | { type: 'fill'; amounts: { major: string; amount: number }[] }
  | { type: 'manual'; majors: string[] }
  | { type: 'undo' }
  | { type: 'saved'; rows: BudgetBaseline[] }

function copyRows(rows: BudgetDraftRow[]): BudgetDraftRow[] {
  return rows.map((row) => ({ ...row }))
}

function rowsFromBaseline(rows: BudgetBaseline[]): BudgetDraftRow[] {
  return rows.map(({ major, amount, recommendationJobId }) => ({
    major,
    amount: String(amount),
    recommendationJobId,
  }))
}

export function createBudgetDraft(baseline: BudgetBaseline[]): BudgetDraft {
  const copiedBaseline = baseline.map((row) => ({ ...row }))
  return {
    rows: rowsFromBaseline(copiedBaseline),
    baseline: copiedBaseline,
    selected: [],
    undoRows: null,
  }
}

export function budgetDraftReducer(state: BudgetDraft, action: BudgetDraftAction): BudgetDraft {
  switch (action.type) {
    case 'edit':
      return {
        ...state,
        rows: state.rows.map((row) => row.major === action.major ? { ...row, amount: action.amount } : row),
      }
    case 'select': {
      const requested = new Set(action.majors)
      return {
        ...state,
        selected: state.rows.filter((row) => requested.has(row.major)).map((row) => row.major),
      }
    }
    case 'apply': {
      const selected = new Set(state.selected)
      const recommendations = new Map(action.completed.report.rows.map((row) => [row.major, row.amount]))
      return {
        ...state,
        undoRows: copyRows(state.rows),
        selected: [],
        rows: state.rows.map((row) => selected.has(row.major) && recommendations.has(row.major)
          ? { ...row, amount: String(recommendations.get(row.major)), recommendationJobId: action.completed.id }
          : row),
      }
    }
    case 'fill': {
      const amounts = new Map(action.amounts.map((row) => [row.major, row.amount]))
      return {
        ...state,
        undoRows: copyRows(state.rows),
        rows: state.rows.map((row) => amounts.has(row.major)
          ? { ...row, amount: String(amounts.get(row.major)), recommendationJobId: null }
          : row),
      }
    }
    case 'manual': {
      const majors = new Set(action.majors)
      return {
        ...state,
        undoRows: copyRows(state.rows),
        rows: state.rows.map((row) => majors.has(row.major) ? { ...row, recommendationJobId: null } : row),
      }
    }
    case 'undo':
      return state.undoRows ? { ...state, rows: copyRows(state.undoRows), undoRows: null } : state
    case 'saved':
      return createBudgetDraft(action.rows)
  }
}

function parseDraftAmount(value: string): number {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) throw new Error('invalid_amount')
  const amount = Number(normalized)
  if (!Number.isSafeInteger(amount)) throw new Error('invalid_amount')
  return amount
}

export function draftBudgetAmounts(state: BudgetDraft): { major: string; amount: number }[] {
  return state.rows.map((row) => ({ major: row.major, amount: parseDraftAmount(row.amount) }))
}

export function draftBudgetChanges(state: BudgetDraft): BudgetSaveRequest['changes'] {
  const amounts = new Map(draftBudgetAmounts(state).map((row) => [row.major, row.amount]))
  const baselines = new Map(state.baseline.map((row) => [row.major, row]))

  return state.rows.flatMap((row) => {
    const baseline = baselines.get(row.major)
    const amount = amounts.get(row.major)
    if (!baseline || amount === undefined) throw new Error('invalid_amount')
    if (amount === baseline.amount && row.recommendationJobId === baseline.recommendationJobId) return []
    return [{
      major: row.major,
      amount,
      recommendationJobId: row.recommendationJobId,
      expectedVersion: baseline.version,
    }]
  })
}
