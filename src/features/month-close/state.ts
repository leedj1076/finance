import { currentMonthInKorea, isMonthKey } from '@/lib/finance'

export type MonthCloseState = 'open' | 'closed' | 'needs_review'
export type MonthStatus = {
  month: string
  revision: number
  closedRevision: number | null
  closedAt: string | null
  state: MonthCloseState
}
export type MonthCloseSummary = MonthStatus & {
  count: number
  income: number
  expense: number
  saving: number
  pendingCount: number
  unclassifiedCount: number
  unpostedRecurringCount: number
  closable: boolean
  requiresAcknowledgment: boolean
}
export type CloseMonthInput = {
  month: string
  revision: number
  acknowledgeWarnings: boolean
  acknowledgeEmpty: boolean
}

export const MONTH_STATE_LABELS: Record<MonthCloseState, string> = {
  open: '미마감', closed: '마감', needs_review: '재확인 필요',
}

export function monthCloseState(row: Pick<MonthStatus, 'revision' | 'closedRevision' | 'closedAt'>): MonthCloseState {
  if (!row.closedAt) return 'open'
  return row.closedRevision === row.revision ? 'closed' : 'needs_review'
}

export function validLedgerMonth(value: unknown): value is string {
  return typeof value === 'string' && isMonthKey(value) && value >= '0001-01' && value < '9999-12'
}

export function canCloseMonth(month: string, now = new Date()) {
  return validLedgerMonth(month) && month < currentMonthInKorea(now)
}

export function validCloseInput(input: unknown): input is CloseMonthInput {
  if (typeof input !== 'object' || input === null) return false
  const row = input as Partial<CloseMonthInput>
  return validLedgerMonth(row.month) && Number.isSafeInteger(row.revision) && Number(row.revision) >= 0
    && typeof row.acknowledgeWarnings === 'boolean' && typeof row.acknowledgeEmpty === 'boolean'
}

export function toMonthStatus(month: string, row?: { revision: number; closedRevision: number | null; closedAt: Date | null }): MonthStatus {
  const status = { month, revision: row?.revision ?? 0, closedRevision: row?.closedRevision ?? null, closedAt: row?.closedAt?.toISOString() ?? null }
  return { ...status, state: monthCloseState(status) }
}
