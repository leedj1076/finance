import 'server-only'

import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { budgetRecommendationJobs as jobs, budgets, diagnosisWorkers } from '@/db/schema'
import { aiInstructionsHash, canonicalAiJson, parseAiPromptInput, resolveAiInstructions } from '@/features/ai-settings/prompt'
import { readAiSettings } from '@/features/ai-settings/service'
import { readBudgetData, type BudgetReader } from '@/features/budgets/queries'
import { currentMonthInKorea, isMonthKey, shiftMonth } from '@/lib/finance'
import { evaluateBudget } from './calculations'
import { BudgetInputError, parseBudgetRequest } from './input'
import { budgetPromptPolicy, buildBudgetPromptInput } from './prompt'
import { parseBudgetRecommendationReport } from './report'
import { hashBudgetPayload, readBudgetSnapshot } from './snapshot'
import type { BudgetInput, BudgetRecommendationData, BudgetRecommendationSnapshot, BudgetRequest, CompletedBudgetRecommendation } from './types'

export class BudgetRecommendationError extends Error {
  constructor(public code: string, public status: 400 | 401 | 403 | 409 | 413 | 503 = 400) { super(code) }
}
type Job = typeof jobs.$inferSelect
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function databaseError(error: unknown, codes: string[], identifiers?: string[], seen = new Set<object>()): boolean {
  if (!error || typeof error !== 'object' || seen.has(error)) return false
  seen.add(error)
  const item = error as { code?: string; message?: string; cause?: unknown }
  if (item.code && codes.includes(item.code) && (!identifiers || identifiers.some(name => new RegExp(`\\b${name}\\b`).test(item.message ?? '')))) return true
  return databaseError(item.cause, codes, identifiers, seen)
}
function missingSchema(error: unknown) {
  return databaseError(error, ['42P01', '42703', '42883'], ['budget_recommendation_jobs', 'ai_diagnosis_settings', 'prompt_input', 'budget_protocol_version', 'budget_last_seen_at', 'prompt_protocol_version', 'prompt_last_seen_at', 'recommendation_job_id'])
}
async function databaseNow(reader: BudgetReader) {
  const [row] = await reader.select({ now: sql<string>`current_timestamp::text` }).from(sql`(select 1) as clock`)
  return new Date(row.now)
}
async function workerState(reader: BudgetReader, householdId: string, now: Date): Promise<BudgetRecommendationData['worker']> {
  const workers = await reader.select({ budgetVersion: diagnosisWorkers.budgetProtocolVersion, promptVersion: diagnosisWorkers.promptProtocolVersion,
    budgetSeen: diagnosisWorkers.budgetLastSeenAt, promptSeen: diagnosisWorkers.promptLastSeenAt }).from(diagnosisWorkers)
    .where(and(eq(diagnosisWorkers.householdId, householdId), isNull(diagnosisWorkers.revokedAt)))
  if (!workers.length) return 'not_registered'
  const capable = workers.filter(row => row.budgetVersion >= 1 && row.promptVersion >= 1)
  if (!capable.length) return 'upgrade_required'
  return capable.some(row => row.budgetSeen && row.promptSeen && row.budgetSeen.getTime() >= now.getTime() - 90_000
    && row.promptSeen.getTime() >= now.getTime() - 90_000) ? 'ready' : 'offline'
}
function eligibleMonth(month: string, now: Date) {
  const current = currentMonthInKorea(now)
  return month === current || month === shiftMonth(current, 1)
}
function inputOnly(input: BudgetInput): BudgetInput {
  return { month: input.month, notes: input.notes, plannedExpenses: input.plannedExpenses, draftAmounts: input.draftAmounts }
}
function assertSameRequest(job: Job, request: BudgetRequest) {
  if (job.month !== request.month || canonicalAiJson(job.snapshot.input) !== canonicalAiJson(inputOnly(request))) throw new BudgetRecommendationError('request_conflict', 409)
}
function validateBaseline(snapshot: BudgetRecommendationSnapshot, legacy: boolean) {
  const state = snapshot.budgetState
  if (state === undefined && legacy) return
  if (!state || state.month !== snapshot.month || Object.keys(state).sort().join() !== 'current,month,previous') throw new Error('invalid_result')
  for (const key of ['current', 'previous'] as const) {
    if (!Array.isArray(state[key]) || state[key].length !== snapshot.rows.length) throw new Error('invalid_result')
    for (const [i, row] of state[key].entries()) {
      if (!row || Object.keys(row).sort().join() !== 'amount,major,recommendationJobId,sourceMonth'
        || row.major !== snapshot.rows[i].major || !Number.isSafeInteger(row.amount) || row.amount < 0
        || !(row.sourceMonth === null || row.sourceMonth === '*' || row.sourceMonth === (key === 'current' ? snapshot.month : shiftMonth(snapshot.month, -1)))
        || !(row.recommendationJobId === null || typeof row.recommendationJobId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.recommendationJobId))) throw new Error('invalid_result')
    }
  }
  if (hashBudgetPayload(state) !== snapshot.budgetHash) throw new Error('invalid_result')
}
function completedResult(job: Job, month: string): CompletedBudgetRecommendation {
  try {
    if (job.status !== 'completed' || !job.completedAt || job.snapshot.version !== 1 || job.snapshot.month !== month) throw new Error('invalid_result')
    validateBaseline(job.snapshot, job.promptInput === null)
    const promptInput = job.promptInput === null ? null : parseAiPromptInput(job.promptInput, 'budget', job.snapshot)
    const report = parseBudgetRecommendationReport(job.report, job.snapshot, promptInput)
    return { id: job.id, completedAt: job.completedAt.toISOString(), snapshot: job.snapshot, promptInput, report, evaluation: evaluateBudget(job.snapshot, report.rows) }
  } catch { throw new BudgetRecommendationError('invalid_result', 409) }
}
function freshness(completed: CompletedBudgetRecommendation, current: BudgetRecommendationSnapshot): BudgetRecommendationData['freshness'] {
  const saved = completed.snapshot
  if (saved.sourceHash !== current.sourceHash) return 'source_changed'
  if (saved.budgetHash === current.budgetHash) return 'current'
  if (!saved.budgetState || canonicalAiJson(saved.budgetState.previous) !== canonicalAiJson(current.budgetState.previous)) return 'budgets_changed'
  let ownChanges = 0
  if (saved.budgetState.current.length !== current.budgetState.current.length) return 'budgets_changed'
  for (const [index, row] of current.budgetState.current.entries()) {
    const original = saved.budgetState.current[index]
    if (canonicalAiJson(original) === canonicalAiJson(row)) continue
    if (row.major !== original.major || row.sourceMonth !== saved.month || row.recommendationJobId !== completed.id) return 'budgets_changed'
    ownChanges += 1
  }
  return ownChanges > 0 ? 'applied' : 'budgets_changed'
}
async function readFreshness(reader: BudgetReader, householdId: string, completed: CompletedBudgetRecommendation, now: Date) {
  try {
    return freshness(completed, await readBudgetSnapshot(reader, householdId, completed.snapshot.input, now))
  } catch (error) {
    // A previously valid planned/draft major can disappear after a category edit.
    // The frozen input is retained; that edit invalidates its financial source.
    if (error instanceof BudgetInputError) return 'source_changed' as const
    throw error
  }
}
const scope = (householdId: string, month: string) => and(eq(jobs.householdId, householdId), eq(jobs.month, month))
async function exactRequest(reader: BudgetReader, householdId: string, requestId: string) {
  return (await reader.select().from(jobs).where(and(eq(jobs.householdId, householdId), eq(jobs.requestId, requestId))).limit(1))[0]
}
async function expireJobs(tx: Transaction, householdId: string, month: string, now: Date, id?: string) {
  await tx.update(jobs).set({ status: 'failed', errorCode: 'lease_expired', completedAt: now, leaseExpiresAt: null, claimToken: null, workerId: null })
    .where(and(scope(householdId, month), id ? eq(jobs.id, id) : undefined, eq(jobs.status, 'running'), lt(jobs.leaseExpiresAt, now)))
}
async function readData(reader: BudgetReader, householdId: string, month: string, now: Date, anchor?: Job): Promise<BudgetRecommendationData> {
  const analysisNow = new Date()
  const [latestRows, completedRows, worker, settings, canonical] = await Promise.all([
    anchor ? Promise.resolve([anchor]) : reader.select().from(jobs).where(scope(householdId, month)).orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(1),
    reader.select().from(jobs).where(and(scope(householdId, month), eq(jobs.status, 'completed'), anchor
      ? sql`${jobs.completedAt} <= (select created_at from budget_recommendation_jobs where id = ${anchor.id}::uuid)` : undefined))
      .orderBy(desc(jobs.completedAt), desc(jobs.createdAt), desc(jobs.id)),
    workerState(reader, householdId, now), readAiSettings(reader, householdId), readBudgetData(reader, householdId, month, analysisNow),
  ])
  const latest = latestRows[0]
  let completed: CompletedBudgetRecommendation | null = null
  const candidates = anchor?.status === 'completed' ? [anchor, ...completedRows.filter(row => row.id !== anchor.id)] : completedRows
  for (const row of candidates) {
    if (row.status !== 'completed') continue
    try { completed = completedResult(row, month); break } catch { /* Preserve preceding verified completion. */ }
  }
  const latestJob: BudgetRecommendationData['latestJob'] = latest ? { id: latest.id, status: latest.status, errorCode: latest.errorCode } : null
  if (latestJob?.status === 'running' && latest.leaseExpiresAt && latest.leaseExpiresAt < now) Object.assign(latestJob, { status: 'failed', errorCode: 'lease_expired' })
  if (latestJob?.status === 'completed') {
    try { completedResult(latest, month) } catch { Object.assign(latestJob, { status: 'failed', errorCode: 'invalid_output' }) }
  }
  const state = completed ? await readFreshness(reader, householdId, completed, analysisNow) : 'current'
  return { month, latestJob, completed, worker,
    availability: worker === 'not_registered' || worker === 'upgrade_required' ? 'setup_required'
      : !eligibleMonth(month, analysisNow) ? 'past_or_distant_month' : canonical.averageIncome <= 0 ? 'missing_income' : 'available',
    freshness: state,
    instructionsChanged: !!completed?.promptInput && completed.promptInput.instructionsHash !== aiInstructionsHash(resolveAiInstructions(settings, 'budget'), budgetPromptPolicy.version) }
}
export async function getBudgetRecommendationData(householdId: string, month: string): Promise<BudgetRecommendationData> {
  if (!isMonthKey(month)) throw new BudgetRecommendationError('invalid_input')
  try {
    return await db.transaction(async tx => readData(tx, householdId, month, await databaseNow(tx)), { isolationLevel: 'repeatable read', accessMode: 'read only' })
  } catch (error) {
    if (!missingSchema(error)) throw error
    return { month, latestJob: null, completed: null, worker: 'upgrade_required', availability: 'setup_required', freshness: 'current', instructionsChanged: false }
  }
}
export async function requestBudgetRecommendation(householdId: string, userId: string, request: BudgetRequest): Promise<BudgetRecommendationData> {
  const input = parseBudgetRequest(request)
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.transaction(async tx => {
        const existing = await exactRequest(tx, householdId, input.requestId)
        if (existing) {
          assertSameRequest(existing, input)
          const now = await databaseNow(tx)
          await expireJobs(tx, householdId, input.month, now, existing.id)
          return readData(tx, householdId, input.month, now, (await exactRequest(tx, householdId, input.requestId))!)
        }
        const now = await databaseNow(tx)
        await expireJobs(tx, householdId, input.month, now)
        const active = await tx.select({ id: jobs.id }).from(jobs).where(and(scope(householdId, input.month), inArray(jobs.status, ['queued', 'running']))).limit(1)
        if (active.length) throw new BudgetRecommendationError('active_job_exists', 409)
        if (!eligibleMonth(input.month, new Date())) throw new BudgetRecommendationError('past_or_distant_month')
        const worker = await workerState(tx, householdId, now)
        if (worker === 'upgrade_required' || worker === 'not_registered') throw new BudgetRecommendationError('setup_required', 503)
        const settings = await readAiSettings(tx, householdId)
        const snapshot = await readBudgetSnapshot(tx, householdId, input)
        if (snapshot.basis.averageIncome <= 0) throw new BudgetRecommendationError('missing_income')
        const promptInput = buildBudgetPromptInput(snapshot, settings)
        const [job] = await tx.insert(jobs).values({ householdId, requestedBy: userId, month: input.month, requestId: input.requestId,
          snapshot, promptInput, fingerprint: hashBudgetPayload({ fingerprint: snapshot.fingerprint, promptHash: promptInput.promptHash }) }).returning()
        return readData(tx, householdId, input.month, now, job)
      }, { isolationLevel: 'repeatable read' })
    } catch (error) {
      if (databaseError(error, ['23505', '40001']) && attempt < 2) continue
      if (missingSchema(error)) throw new BudgetRecommendationError('setup_required', 503)
      if (error instanceof BudgetInputError) throw new BudgetRecommendationError('invalid_input')
      if (error instanceof Error && error.message === 'invalid_amount') throw new BudgetRecommendationError('invalid_input')
      if (error instanceof Error && error.message === 'input_too_large') throw new BudgetRecommendationError('body_too_large', 413)
      throw error
    }
  }
}
export async function readApplicableBudgetRecommendation(reader: BudgetReader, householdId: string, month: string, jobId: string, now = new Date()): Promise<CompletedBudgetRecommendation> {
  const [job] = await reader.select().from(jobs).where(and(scope(householdId, month), eq(jobs.id, jobId))).limit(1)
  if (!job) throw new BudgetRecommendationError('invalid_result', 409)
  const completed = completedResult(job, month)
  const state = await readFreshness(reader, householdId, completed, now)
  if (state === 'source_changed' || state === 'budgets_changed') throw new BudgetRecommendationError(state, 409)
  return completed
}

export async function readSavedBudgetRecommendations(reader: BudgetReader, householdId: string, month: string): Promise<CompletedBudgetRecommendation[]> {
  const rows = await reader.select({ job: jobs }).from(budgets)
    .innerJoin(jobs, and(eq(jobs.id, budgets.recommendationJobId), eq(jobs.householdId, budgets.householdId), eq(jobs.month, budgets.month)))
    .where(and(eq(budgets.householdId, householdId), eq(budgets.month, month), scope(householdId, month), eq(jobs.status, 'completed')))
    .groupBy(jobs.id)
    .orderBy(desc(jobs.completedAt), desc(jobs.id))
  const completed: CompletedBudgetRecommendation[] = []
  for (const row of rows) {
    try { completed.push(completedResult(row.job, month)) } catch { /* Invalid saved evidence must not block manual budget editing. */ }
  }
  return completed
}

export function getSavedBudgetRecommendations(householdId: string, month: string): Promise<CompletedBudgetRecommendation[]> {
  return readSavedBudgetRecommendations(db, householdId, month)
}
