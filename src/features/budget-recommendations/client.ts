import { isMonthKey } from '@/lib/finance'

import { evaluateBudget } from './calculations'
import { parseBudgetRequest } from './input'
import type {
  BudgetEvaluation,
  BudgetFinding,
  BudgetRecommendationData,
  BudgetRecommendationReport,
  BudgetRecommendationSnapshot,
  BudgetRequest,
  BudgetReference,
  CompletedBudgetRecommendation,
} from './types'

const REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_POLL_INTERVAL_MS = 5_000
const MAX_POLL_INTERVAL_MS = 30_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH_PATTERN = /^[0-9a-f]{64}$/

const responseErrorCodes = new Set([
  'invalid_input',
  'unauthorized',
  'forbidden',
  'body_too_large',
  'active_job_exists',
  'request_conflict',
  'past_or_distant_month',
  'missing_income',
  'setup_required',
  'source_changed',
  'budgets_changed',
  'invalid_result',
  'request_failed',
])
const jobErrorCodes = new Set(['timeout', 'invalid_output', 'cli_failed', 'worker_stopped', 'lease_expired'])
const jobStatuses = new Set(['queued', 'running', 'completed', 'failed'])
const workerStatuses = new Set(['ready', 'offline', 'upgrade_required', 'not_registered'])
const availabilityStatuses = new Set(['available', 'past_or_distant_month', 'missing_income', 'setup_required'])
const freshnessStatuses = new Set(['current', 'source_changed', 'budgets_changed', 'applied'])

class ClientError extends Error {
  constructor(message: string, readonly invalidResponse = false) {
    super(message)
    this.name = 'BudgetRecommendationClientError'
  }
}

function invalid(): never {
  throw new ClientError('request_failed', true)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) invalid()
  return value as Record<string, unknown>
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = record(value)
  const actual = Object.keys(result)
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) invalid()
  return result
}

function text(value: unknown, max = 20_000, allowEmpty = false): string {
  if (typeof value !== 'string' || [...value].length > max || (!allowEmpty && !value.trim())) invalid()
  return value
}

function safeInteger(value: unknown, minimum = Number.MIN_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid()
  return value as number
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid()
  return value
}

function list(value: unknown, maximum = 10_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid()
  return value
}

function validateSnapshot(value: unknown, requestedMonth: string): BudgetRecommendationSnapshot {
  const snapshot = record(value)
  if (snapshot.version !== 1 || snapshot.month !== requestedMonth) invalid()
  text(snapshot.asOfDate)
  text(snapshot.sourceHash)
  text(snapshot.budgetHash)
  text(snapshot.fingerprint)

  const input = record(snapshot.input)
  if (input.month !== requestedMonth) invalid()
  text(input.notes, 4_000, true)
  for (const value of list(input.plannedExpenses, 30)) {
    const row = record(value)
    text(row.id)
    text(row.major)
    safeInteger(row.amount, 0)
    text(row.note, 200, true)
  }
  for (const value of list(input.draftAmounts, 500)) {
    const row = record(value)
    text(row.major)
    safeInteger(row.amount, 0)
  }

  const basis = record(snapshot.basis)
  safeInteger(basis.averageIncome)
  number(basis.savingsTarget)
  safeInteger(basis.spendCeiling)
  text(basis.incomeStart)
  text(basis.incomeEnd)
  safeInteger(basis.incomeMonthCount, 0)

  const current = record(snapshot.current)
  for (const key of ['income', 'expense', 'saving', 'unallocatedActual', 'unallocatedRecurring']) {
    safeInteger(current[key])
  }

  const seenMajors = new Set<string>()
  for (const value of list(snapshot.rows, 500)) {
    const row = record(value)
    const major = text(row.major)
    if (seenMajors.has(major) || !['fixed', 'variable', 'irregular'].includes(row.group as string)) invalid()
    seenMajors.add(major)
    for (const key of [
      'savedAmount', 'actual', 'unpostedRecurring', 'planned', 'floor',
      'previousBudget', 'previousActual', 'average', 'median',
    ]) safeInteger(row[key])
    if (row.savedRecommendationJobId !== null
      && (typeof row.savedRecommendationJobId !== 'string' || !UUID_PATTERN.test(row.savedRecommendationJobId))) invalid()
    for (const item of list(row.subcategories, 500)) {
      const subcategory = record(item)
      text(subcategory.sub)
      text(subcategory.month)
      safeInteger(subcategory.amount)
    }
  }

  for (const value of list(snapshot.history, 500)) {
    const month = record(value)
    text(month.month)
    if (!['open', 'closed', 'needs_review'].includes(month.state as string)
      || typeof month.hasRecords !== 'boolean' || typeof month.partial !== 'boolean') invalid()
    for (const key of ['income', 'expense', 'saving']) safeInteger(month[key])
    for (const value of list(month.majors, 500)) {
      const row = record(value)
      text(row.major)
      safeInteger(row.amount)
    }
  }

  for (const value of list(snapshot.recurring, 500)) {
    const row = record(value)
    safeInteger(row.id, 1)
    if (row.major !== null) text(row.major)
    safeInteger(row.amount)
    text(row.date)
    if (typeof row.posted !== 'boolean') invalid()
    text(row.memo, 20_000, true)
  }

  for (const value of list(snapshot.evidence, 2_000)) {
    const row = record(value)
    safeInteger(row.id, 1)
    text(row.date)
    if (!['expense', 'income', 'saving'].includes(row.flow as string)) invalid()
    safeInteger(row.amount)
    if (row.major !== null) text(row.major)
    if (row.sub !== null) text(row.sub)
    text(row.merchant, 20_000, true)
  }

  const evidenceCount = record(snapshot.evidenceCount)
  safeInteger(evidenceCount.total, 0)
  safeInteger(evidenceCount.provided, 0)
  safeInteger(snapshot.pendingCount, 0)
  safeInteger(snapshot.unclassifiedCount, 0)
  return snapshot as BudgetRecommendationSnapshot
}

function validatePromptInput(value: unknown): CompletedBudgetRecommendation['promptInput'] {
  if (value === null) return null
  const prompt = exactRecord(value, [
    'version', 'kind', 'instructions', 'policyVersion', 'instructionsHash', 'prefix', 'suffix', 'promptHash',
  ])
  if (prompt.version !== 1 || prompt.kind !== 'budget') invalid()
  text(prompt.policyVersion, 64)
  text(prompt.prefix, 128 * 1024, true)
  text(prompt.suffix, 128 * 1024, true)
  if (typeof prompt.instructionsHash !== 'string' || !HASH_PATTERN.test(prompt.instructionsHash)
    || typeof prompt.promptHash !== 'string' || !HASH_PATTERN.test(prompt.promptHash)) invalid()
  const instructions = exactRecord(prompt.instructions, [
    'kind', 'settingsRevision', 'defaultsVersion', 'common', 'task', 'commonSource', 'taskSource',
  ])
  if (instructions.kind !== 'budget'
    || !Number.isInteger(instructions.settingsRevision) || (instructions.settingsRevision as number) < 0
    || !['default', 'custom'].includes(instructions.commonSource as string)
    || !['default', 'custom'].includes(instructions.taskSource as string)) invalid()
  text(instructions.defaultsVersion, 64)
  text(instructions.common, 4_000, true)
  text(instructions.task, 6_000, true)
  return prompt as CompletedBudgetRecommendation['promptInput']
}

type ReportContext = {
  snapshot: BudgetRecommendationSnapshot
  promptInput: CompletedBudgetRecommendation['promptInput']
  evidence: Map<number, BudgetRecommendationSnapshot['evidence'][number]>
  recurring: Map<number, BudgetRecommendationSnapshot['recurring'][number]>
  planned: Map<string, BudgetRecommendationSnapshot['input']['plannedExpenses'][number]>
}

function uniqueMap<T, K>(values: T[], key: (value: T) => K): Map<K, T> {
  const result = new Map<K, T>()
  for (const value of values) {
    const itemKey = key(value)
    if (result.has(itemKey)) invalid()
    result.set(itemKey, value)
  }
  return result
}

function validateReference(value: unknown, context: ReportContext, major?: string): BudgetReference {
  const input = record(value)
  if (input.kind === 'transaction') {
    const item = exactRecord(input, ['kind', 'id'])
    const id = safeInteger(item.id, 1)
    const source = context.evidence.get(id)
    if (!source || (major !== undefined && source.major !== major)) invalid()
    return { kind: 'transaction', id }
  }
  if (input.kind === 'recurring') {
    const item = exactRecord(input, ['kind', 'id'])
    const id = safeInteger(item.id, 1)
    const source = context.recurring.get(id)
    if (!source || (major !== undefined && source.major !== major)) invalid()
    return { kind: 'recurring', id }
  }
  if (input.kind === 'planned') {
    const item = exactRecord(input, ['kind', 'id'])
    const id = text(item.id, 2_000)
    const source = context.planned.get(id)
    if (!source || (major !== undefined && source.major !== major)) invalid()
    return { kind: 'planned', id }
  }
  if (input.kind === 'notes') {
    const item = exactRecord(input, ['kind', 'quote'])
    const quote = text(item.quote, 200)
    if (!context.snapshot.input.notes.includes(quote)) invalid()
    return { kind: 'notes', quote }
  }
  if (input.kind === 'instructions') {
    const item = exactRecord(input, ['kind', 'scope', 'quote'])
    if (item.scope !== 'common' && item.scope !== 'task') invalid()
    const quote = text(item.quote, 200)
    if (!context.promptInput || !context.promptInput.instructions[item.scope].includes(quote)) invalid()
    return { kind: 'instructions', scope: item.scope, quote }
  }
  invalid()
}

function validateReferences(value: unknown, context: ReportContext, major?: string): BudgetReference[] {
  return list(value, 30).map((item) => validateReference(item, context, major))
}

function validateFinding(
  value: unknown,
  context: ReportContext,
  options: { major?: string; allowEmptyHypothesis: boolean },
): BudgetFinding {
  const input = exactRecord(value, ['text', 'certainty', 'references'])
  if (!['recorded', 'user_provided', 'hypothesis'].includes(input.certainty as string)) invalid()
  const references = validateReferences(input.references, context, options.major)
  const hasRecorded = references.some((item) => item.kind === 'transaction' || item.kind === 'recurring')
  const hasUser = references.some((item) => item.kind === 'planned' || item.kind === 'notes' || item.kind === 'instructions')
  if (input.certainty === 'recorded' && !hasRecorded) invalid()
  if (input.certainty === 'user_provided' && !hasUser) invalid()
  if (!references.length && (input.certainty !== 'hypothesis' || !options.allowEmptyHypothesis)) invalid()
  return {
    text: text(input.text, 2_000),
    certainty: input.certainty as BudgetFinding['certainty'],
    references,
  }
}

function validateReport(
  value: unknown,
  snapshot: BudgetRecommendationSnapshot,
  promptInput: CompletedBudgetRecommendation['promptInput'],
): { report: BudgetRecommendationReport; evaluation: BudgetEvaluation } {
  const input = exactRecord(value, ['version', 'summary', 'limitations', 'overCeilingReason', 'adjustments', 'rows'])
  if (input.version !== 1) invalid()
  const context: ReportContext = {
    snapshot,
    promptInput,
    evidence: uniqueMap(snapshot.evidence, (item) => item.id),
    recurring: uniqueMap(snapshot.recurring, (item) => item.id),
    planned: uniqueMap(snapshot.input.plannedExpenses, (item) => item.id),
  }
  const sourceRows = uniqueMap(snapshot.rows, (item) => item.major)
  const reportRows = new Map<string, BudgetRecommendationReport['rows'][number]>()
  for (const value of list(input.rows, snapshot.rows.length)) {
    const row = exactRecord(value, ['major', 'amount', 'reason', 'references', 'exceptional', 'reducible'])
    const major = text(row.major, 2_000)
    const source = sourceRows.get(major)
    const amount = safeInteger(row.amount, 0)
    if (!source || reportRows.has(major) || amount < source.floor) invalid()
    reportRows.set(major, {
      major,
      amount,
      reason: text(row.reason, 2_000),
      references: validateReferences(row.references, context, major),
      exceptional: list(row.exceptional, 10).map((item) => validateFinding(item, context, {
        major, allowEmptyHypothesis: false,
      })),
      reducible: list(row.reducible, 10).map((item) => validateFinding(item, context, {
        major, allowEmptyHypothesis: true,
      })),
    })
  }
  if (reportRows.size !== snapshot.rows.length) invalid()
  const rows = snapshot.rows.map((source) => reportRows.get(source.major)!)
  const evaluation = evaluateBudget(snapshot, rows)
  const adjustments = list(input.adjustments, 20).map((item) => validateFinding(item, context, {
    allowEmptyHypothesis: true,
  }))
  const overCeilingReason = text(input.overCeilingReason, 2_000, true)
  if (evaluation.overage > 0 && (!overCeilingReason.trim() || !adjustments.length)) invalid()
  return {
    report: {
      version: 1,
      summary: text(input.summary, 2_000),
      limitations: list(input.limitations, 20).map((item) => text(item, 500)),
      overCeilingReason,
      adjustments,
      rows,
    },
    evaluation,
  }
}

function validateEvaluation(value: unknown, expected: BudgetEvaluation): void {
  const input = exactRecord(value, ['allocated', 'unallocatedReserve', 'total', 'overage', 'savingsRate', 'rows'])
  for (const key of ['allocated', 'unallocatedReserve', 'total', 'overage']) {
    if (safeInteger(input[key]) !== expected[key as keyof Pick<BudgetEvaluation, 'allocated' | 'unallocatedReserve' | 'total' | 'overage'>]) invalid()
  }
  if (number(input.savingsRate) !== expected.savingsRate) invalid()
  const rows = list(input.rows, expected.rows.length)
  if (rows.length !== expected.rows.length) invalid()
  rows.forEach((value, index) => {
    const row = exactRecord(value, ['major', 'amount', 'remainingAllocation'])
    const expectedRow = expected.rows[index]
    if (row.major !== expectedRow.major || safeInteger(row.amount, 0) !== expectedRow.amount
      || safeInteger(row.remainingAllocation) !== expectedRow.remainingAllocation) invalid()
  })
}

function validateCompleted(value: unknown, month: string): CompletedBudgetRecommendation | null {
  if (value === null) return null
  const completed = record(value)
  if (typeof completed.id !== 'string' || !UUID_PATTERN.test(completed.id)) invalid()
  text(completed.completedAt)
  const snapshot = validateSnapshot(completed.snapshot, month)
  const promptInput = validatePromptInput(completed.promptInput)
  const { report, evaluation } = validateReport(completed.report, snapshot, promptInput)
  validateEvaluation(completed.evaluation, evaluation)
  return {
    id: completed.id,
    completedAt: completed.completedAt as string,
    snapshot,
    promptInput,
    report,
    evaluation,
  }
}

function validateData(value: unknown, month: string): BudgetRecommendationData {
  const input = record(value)
  if (input.month !== month || !workerStatuses.has(input.worker as string)
    || !availabilityStatuses.has(input.availability as string)
    || !freshnessStatuses.has(input.freshness as string)
    || typeof input.instructionsChanged !== 'boolean') invalid()

  let latestJob: BudgetRecommendationData['latestJob'] = null
  if (input.latestJob !== null) {
    const latest = record(input.latestJob)
    if (typeof latest.id !== 'string' || !UUID_PATTERN.test(latest.id)
      || !jobStatuses.has(latest.status as string)
      || (latest.errorCode !== null && !jobErrorCodes.has(latest.errorCode as string))) invalid()
    latestJob = {
      id: latest.id,
      status: latest.status as NonNullable<BudgetRecommendationData['latestJob']>['status'],
      errorCode: latest.errorCode as NonNullable<BudgetRecommendationData['latestJob']>['errorCode'],
    }
  }

  return {
    month,
    latestJob,
    completed: validateCompleted(input.completed, month),
    worker: input.worker as BudgetRecommendationData['worker'],
    availability: input.availability as BudgetRecommendationData['availability'],
    freshness: input.freshness as BudgetRecommendationData['freshness'],
    instructionsChanged: input.instructionsChanged,
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

async function requestData(
  month: string,
  init: Omit<RequestInit, 'signal'>,
  callerSignal?: AbortSignal,
): Promise<BudgetRecommendationData> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(abortError())
  if (callerSignal?.aborted) abortFromCaller()
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(abortError())
  }, REQUEST_TIMEOUT_MS)

  const checkAbort = () => {
    if (callerSignal?.aborted) throw abortError()
    if (timedOut) throw new ClientError('request_timeout')
  }

  try {
    checkAbort()
    const response = await fetch(`/api/budget-recommendations?month=${encodeURIComponent(month)}`, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
    })
    checkAbort()
    let result: unknown
    try {
      result = await response.json()
    } catch {
      throw new ClientError('request_failed', true)
    }
    checkAbort()
    if (!response.ok) {
      const body = result && typeof result === 'object' && !Array.isArray(result)
        ? result as Record<string, unknown> : null
      const code = typeof body?.error === 'string' && responseErrorCodes.has(body.error)
        ? body.error : 'request_failed'
      throw new ClientError(code)
    }
    try {
      return validateData(result, month)
    } catch {
      throw new ClientError('request_failed', true)
    }
  } catch (error) {
    checkAbort()
    if (error instanceof ClientError) throw error
    throw new ClientError('request_failed')
  } finally {
    clearTimeout(timeout)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function getBudgetRecommendations(
  month: string,
  signal?: AbortSignal,
): Promise<BudgetRecommendationData> {
  if (!isMonthKey(month)) throw new ClientError('invalid_input')
  return requestData(month, { method: 'GET' }, signal)
}

export async function startBudgetRecommendation(
  request: BudgetRequest,
  signal?: AbortSignal,
): Promise<BudgetRecommendationData> {
  let parsed: BudgetRequest
  try {
    parsed = parseBudgetRequest(request)
  } catch {
    throw new ClientError('invalid_input')
  }
  return requestData(parsed.month, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed),
  }, signal)
}

function pollErrorCode(error: unknown): string {
  return error instanceof ClientError
    && (responseErrorCodes.has(error.message) || error.message === 'request_timeout')
    ? error.message : 'request_failed'
}

function waitForPoll(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(ready)
    }
    const onAbort = () => finish(false)
    const timer = setTimeout(() => finish(true), ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function pollBudgetRecommendations(month: string, options: {
  signal: AbortSignal
  onData: (value: BudgetRecommendationData) => void
  onError: (code: string) => void
  fetchData?: typeof getBudgetRecommendations
  intervalMs?: number
}): Promise<void> {
  const fetchData = options.fetchData ?? getBudgetRecommendations
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
  let failures = 0

  while (!options.signal.aborted) {
    const delay = Math.min(intervalMs * 2 ** failures, MAX_POLL_INTERVAL_MS)
    if (!await waitForPoll(delay, options.signal)) return
    try {
      const value = await fetchData(month, options.signal)
      if (options.signal.aborted) return
      if (value.month !== month) throw new ClientError('request_failed', true)
      options.onData(value)
      failures = 0
      if (value.latestJob?.status !== 'queued' && value.latestJob?.status !== 'running') return
    } catch (error) {
      if (options.signal.aborted) return
      failures += 1
      options.onError(pollErrorCode(error))
    }
  }
}

export async function checkRecommendationForApply(
  month: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<CompletedBudgetRecommendation> {
  let value: BudgetRecommendationData
  try {
    value = await getBudgetRecommendations(month, signal)
  } catch (error) {
    if (error instanceof ClientError && error.invalidResponse) throw new ClientError('invalid_result')
    throw error
  }
  if (value.freshness === 'source_changed') throw new ClientError('source_changed')
  if (value.freshness === 'budgets_changed') throw new ClientError('budgets_changed')
  if (!value.completed || value.completed.id !== jobId) throw new ClientError('invalid_result')
  return value.completed
}
