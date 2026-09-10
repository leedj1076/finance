export type DiagnosisTransaction = {
  id: number
  date: string
  flow: 'income' | 'expense' | 'saving'
  amount: number
  major: string
  sub: string
  merchant: string
  memo?: string
}

export type DiagnosisMonth = {
  month: string
  count: number
  income: number
  salary: number
  salaryCount: number
  expense: number
  saving: number
  comparableExpense: number
}

export type DiagnosisSnapshot = {
  version: 1
  month: string
  asOf: string
  sourceHash: string
  current: DiagnosisMonth & {
    otherIncome: number
    salaryRemainder: number
    totalRemainder: number
    savingsRate: number | null
  }
  months: DiagnosisMonth[]
  comparison: {
    previousExpense: number | null
    expenseDelta: number | null
    expenseChangeRate: number | null
    baselineMonthCount: number
    expenseAverage: number | null
    comparableExpenseAverage: number | null
  }
  categories: Array<{
    major: string
    amount: number
    previous: number | null
    delta: number | null
    count: number
    budget: number | null
  }>
  budget: { total: number | null; savingsRateTarget: number | null }
  transactions: DiagnosisTransaction[]
  evidenceCount: number
}

export type DiagnosisReport = {
  version: 1
  headline: string
  summary: string
  changes: Array<{ title: string; body: string; category: string | null; transactionIds: number[] }>
  trend: { summary: string; caveat: string }
  checks: Array<{ title: string; body: string; transactionIds: number[] }>
  actions: Array<{ title: string; body: string }>
  positive: string | null
}

export type DiagnosisStatus = 'queued' | 'running' | 'completed' | 'failed'
export type DiagnosisErrorCode = 'timeout' | 'invalid_output' | 'cli_failed' | 'worker_stopped' | 'lease_expired'

export type DiagnosisJobView = {
  id: string
  status: DiagnosisStatus
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  errorCode: DiagnosisErrorCode | null
}

export type DiagnosisPageData = {
  month: string
  latestJob: DiagnosisJobView | null
  completed: {
    id: string
    completedAt: string
    snapshot: DiagnosisSnapshot
    report: DiagnosisReport
    promptInput?: AiPromptInput | null
  } | null
  currentSnapshot: DiagnosisSnapshot
  isStale: boolean
  workerOnline: boolean
  setupRequired: boolean
  instructionsChanged: boolean
  promptSetupRequired: boolean
}

export type ClaimedDiagnosisJob = {
  id: string
  claimToken: string
  snapshot: DiagnosisSnapshot
}
import type { AiPromptInput } from '@/features/ai-settings/types'
