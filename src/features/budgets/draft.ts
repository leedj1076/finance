import { initialSource } from './plan-calculations'
import type { BudgetPlanRow, BudgetSource } from './plan-sources'
import type { BudgetBaseline, BudgetSaveRequest } from './save-contract'

export type BudgetDraftRow = {
  major: string
  amount: string
  source: BudgetSource | null
  recommendationJobId: string | null
}

export type BudgetDraft = {
  rows: BudgetDraftRow[]
  baseline: BudgetBaseline[]
  undoRows: BudgetDraftRow[] | null
}

export type BudgetDraftChoice = {
  major: string
  amount: number
  source: BudgetSource | null
  recommendationJobId: string | null
}

export type BudgetDraftAction =
  | { type: 'edit'; major: string; amount: string }
  | ({ type: 'choose' } & BudgetDraftChoice)
  | { type: 'fill'; choices: BudgetDraftChoice[] }
  | { type: 'undo' }
  | { type: 'rebase'; rows: BudgetBaseline[] }
  | { type: 'saved'; rows: BudgetBaseline[] }

export function manualDraftChoice(row: BudgetDraftRow): BudgetDraftChoice | null {
  try {
    return {
      major: row.major,
      amount: parseDraftAmount(row.amount),
      source: null,
      recommendationJobId: null,
    }
  } catch {
    return null
  }
}

function copyRows(rows: BudgetDraftRow[]): BudgetDraftRow[] {
  return rows.map((row) => ({ ...row }))
}

function rowFromBaseline(
  row: BudgetBaseline,
  plan?: BudgetPlanRow,
  completedJobId: string | null = null,
  recommendedAmount?: number,
): BudgetDraftRow {
  return {
    major: row.major,
    amount: String(row.amount),
    source: plan ? initialSource({ ...plan, saved: row }, completedJobId, recommendedAmount) : null,
    recommendationJobId: row.recommendationJobId,
  }
}

export function createBudgetDraft(
  baseline: BudgetBaseline[],
  plan: BudgetPlanRow[] = [],
  completedJobId: string | null = null,
  recommendedAmounts: Record<string, number> = {},
): BudgetDraft {
  const copiedBaseline = baseline.map((row) => ({ ...row }))
  const planByMajor = new Map(plan.map((row) => [row.major, row]))
  return {
    rows: copiedBaseline.map((row) => rowFromBaseline(
      row,
      planByMajor.get(row.major),
      completedJobId,
      recommendedAmounts[row.major],
    )),
    baseline: copiedBaseline,
    undoRows: null,
  }
}

function chosenRow(row: BudgetDraftRow, choice: BudgetDraftChoice): BudgetDraftRow {
  return {
    ...row,
    amount: String(choice.amount),
    source: choice.source,
    recommendationJobId: choice.source === 'ai' ? choice.recommendationJobId : null,
  }
}

export function budgetDraftReducer(state: BudgetDraft, action: BudgetDraftAction): BudgetDraft {
  switch (action.type) {
    case 'edit':
      return {
        ...state,
        rows: state.rows.map((row) => row.major === action.major
          ? { ...row, amount: action.amount, source: null }
          : row),
      }
    case 'choose':
      return {
        ...state,
        rows: state.rows.map((row) => row.major === action.major ? chosenRow(row, action) : row),
      }
    case 'fill': {
      const choices = new Map(action.choices.map((choice) => [choice.major, choice]))
      return {
        ...state,
        undoRows: copyRows(state.rows),
        rows: state.rows.map((row) => {
          const choice = choices.get(row.major)
          return choice ? chosenRow(row, choice) : row
        }),
      }
    }
    case 'undo':
      return state.undoRows ? { ...state, rows: copyRows(state.undoRows), undoRows: null } : state
    case 'rebase': {
      const previousRows = new Map(state.rows.map((row) => [row.major, row]))
      const previousBaseline = new Map(state.baseline.map((row) => [row.major, row]))
      const nextBaseline = action.rows.map((row) => ({ ...row }))
      return {
        rows: nextBaseline.map((baseline) => {
          const row = previousRows.get(baseline.major)
          const previous = previousBaseline.get(baseline.major)
          if (!row || !previous) return rowFromBaseline(baseline)
          let amountDirty = true
          try { amountDirty = parseDraftAmount(row.amount) !== previous.amount } catch { /* Invalid in-progress input is dirty. */ }
          const provenanceDirty = row.recommendationJobId !== previous.recommendationJobId
          return amountDirty || provenanceDirty ? { ...row } : rowFromBaseline(baseline)
        }),
        baseline: nextBaseline,
        undoRows: null,
      }
    }
    case 'saved': {
      const acknowledged = new Map(state.rows.map((row) => [row.major, row]))
      const baseline = action.rows.map((row) => ({ ...row }))
      return {
        rows: baseline.map((saved) => {
          const row = acknowledged.get(saved.major)
          if (!row) return rowFromBaseline(saved)
          let amountMatches = false
          try { amountMatches = parseDraftAmount(row.amount) === saved.amount } catch { /* Server acknowledgement wins. */ }
          return amountMatches && row.recommendationJobId === saved.recommendationJobId
            ? { ...row, amount: String(saved.amount) }
            : rowFromBaseline(saved)
        }),
        baseline,
        undoRows: null,
      }
    }
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
