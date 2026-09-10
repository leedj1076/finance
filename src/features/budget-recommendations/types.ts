import type { AiPromptInput } from '@/features/ai-settings/types'
import type { DiagnosisErrorCode } from '@/features/diagnosis/types'

export type BudgetInput = {
  month: string
  notes: string
  plannedExpenses: { id: string; major: string; amount: number; note: string }[]
  draftAmounts: { major: string; amount: number }[]
}

export type BudgetRequest = BudgetInput & { requestId: string }

export type BudgetSourceRow = {
  major: string
  group: 'fixed' | 'variable' | 'irregular'
  savedAmount: number
  savedRecommendationJobId: string | null
  actual: number
  unpostedRecurring: number
  planned: number
  floor: number
  previousBudget: number
  previousActual: number
  average: number
  median: number
  subcategories: { sub: string; month: string; amount: number }[]
}

export type BudgetEvidence = {
  id: number
  date: string
  flow: 'expense' | 'income' | 'saving'
  amount: number
  major: string | null
  sub: string | null
  merchant: string
}

export type EffectiveBudgetState = {
  major: string
  amount: number
  sourceMonth: string | null
  recommendationJobId: string | null
}

export type BudgetRecommendationSnapshot = {
  version: 1
  month: string
  asOfDate: string
  sourceHash: string
  budgetHash: string
  budgetState: { month: string; current: EffectiveBudgetState[]; previous: EffectiveBudgetState[] }
  fingerprint: string
  input: BudgetInput
  basis: {
    averageIncome: number
    savingsTarget: number
    spendCeiling: number
    incomeStart: string
    incomeEnd: string
    incomeMonthCount: number
  }
  current: {
    income: number
    expense: number
    saving: number
    unallocatedActual: number
    unallocatedRecurring: number
  }
  rows: BudgetSourceRow[]
  history: {
    month: string
    state: 'open' | 'closed' | 'needs_review'
    hasRecords: boolean
    partial: boolean
    income: number
    expense: number
    saving: number
    majors: { major: string; amount: number }[]
  }[]
  recurring: {
    id: number
    major: string | null
    amount: number
    date: string
    posted: boolean
    memo: string
  }[]
  evidence: BudgetEvidence[]
  evidenceCount: { total: number; provided: number }
  pendingCount: number
  unclassifiedCount: number
}

export type BudgetReference =
  | { kind: 'transaction'; id: number }
  | { kind: 'recurring'; id: number }
  | { kind: 'planned'; id: string }
  | { kind: 'notes'; quote: string }
  | { kind: 'instructions'; scope: 'common' | 'task'; quote: string }

export type BudgetFinding = {
  text: string
  certainty: 'recorded' | 'user_provided' | 'hypothesis'
  references: BudgetReference[]
}

export type BudgetRecommendationReport = {
  version: 1
  summary: string
  limitations: string[]
  overCeilingReason: string
  adjustments: BudgetFinding[]
  rows: {
    major: string
    amount: number
    reason: string
    references: BudgetReference[]
    exceptional: BudgetFinding[]
    reducible: BudgetFinding[]
  }[]
}

export type BudgetEvaluation = {
  allocated: number
  unallocatedReserve: number
  total: number
  overage: number
  savingsRate: number
  rows: { major: string; amount: number; remainingAllocation: number }[]
}

export type BudgetJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export type ClaimedBudgetJob = {
  id: string
  claimToken: string
  snapshot: BudgetRecommendationSnapshot
  promptInput: AiPromptInput
}

export type CompletedBudgetRecommendation = {
  id: string
  completedAt: string
  snapshot: BudgetRecommendationSnapshot
  promptInput: AiPromptInput | null
  report: BudgetRecommendationReport
  evaluation: BudgetEvaluation
}

export type BudgetRecommendationData = {
  month: string
  latestJob: { id: string; status: BudgetJobStatus; errorCode: DiagnosisErrorCode | null } | null
  completed: CompletedBudgetRecommendation | null
  worker: 'ready' | 'offline' | 'upgrade_required' | 'not_registered'
  availability: 'available' | 'past_or_distant_month' | 'missing_income' | 'setup_required'
  freshness: 'current' | 'source_changed' | 'budgets_changed' | 'applied'
  instructionsChanged: boolean
}
