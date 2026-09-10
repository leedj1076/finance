import 'server-only'

import { createHash } from 'node:crypto'
import { and, asc, desc, eq, exists, getTableColumns, gte, inArray, isNull, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { budgets, categories, diagnosisJobs, diagnosisWorkers, settings, transactions } from '@/db/schema'
import { isMonthKey, monthBounds, shiftMonth } from '@/lib/finance'
import { aiInstructionsHash, parseAiPromptInput, resolveAiInstructions } from '@/features/ai-settings/prompt'
import { readAiSettings, type AiSettingsReader } from '@/features/ai-settings/service'
import { buildDiagnosisPromptInput, diagnosisPromptPolicy } from './prompt'
import { parseDiagnosisReport } from './report'
import { buildDiagnosisSnapshot, diagnosisFingerprint } from './snapshot'
import type { DiagnosisJobView, DiagnosisPageData, DiagnosisSnapshot } from './types'

export class DiagnosisRequestError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export async function getDiagnosisSnapshot(householdId: string, month: string) {
  return readDiagnosisSnapshot(db, householdId, month)
}

export async function readDiagnosisSnapshot(reader: AiSettingsReader, householdId: string, month: string): Promise<DiagnosisSnapshot> {
  if (!isMonthKey(month)) throw new DiagnosisRequestError('조회할 월을 확인해주세요.')
  const { end } = monthBounds(month)
  const [rows, budgetRows, target] = await Promise.all([
    reader.select({ id: transactions.id, date: transactions.date, flow: transactions.flow, amount: transactions.amount, major: categories.major, sub: categories.sub, categoryId: transactions.categoryId, accountId: transactions.accountId, fixed: transactions.fixed, rawMerchant: transactions.rawMerchant, memo: transactions.memo })
      .from(transactions)
      .leftJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)))
      .where(and(eq(transactions.householdId, householdId), gte(transactions.date, `${shiftMonth(month, -3)}-01`), lt(transactions.date, end)))
      .orderBy(asc(transactions.date), asc(transactions.id)),
    reader.select({ major: budgets.major, month: budgets.month, amount: budgets.amount }).from(budgets)
      .where(and(eq(budgets.householdId, householdId), inArray(budgets.month, ['*', month]),
        exists(reader.select({ id: categories.id }).from(categories).where(and(eq(categories.householdId, householdId), eq(categories.major, budgets.major), eq(categories.kind, 'expense'), eq(categories.hidden, false)))),
      )),
    reader.select({ value: settings.value }).from(settings)
      .where(and(eq(settings.householdId, householdId), eq(settings.key, 'savings_target'))).limit(1),
  ])
  return buildDiagnosisSnapshot({ month, budgetRows, savingsRateTarget: target[0]?.value?.trim() ? Number(target[0].value) : null,
    sourceRevision: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    rows: rows.map(row => ({ id: row.id, date: row.date, flow: row.flow, amount: row.amount, major: row.major ?? '미분류', sub: row.sub ?? '', merchant: (row.rawMerchant || row.memo || row.major || '미분류').replace(/[\u0000-\u001f]/g, ' ').slice(0, 240), memo: (row.memo ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 500) })),
  })
}

type Job = typeof diagnosisJobs.$inferSelect
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const scope = (householdId: string, month: string) => and(eq(diagnosisJobs.householdId, householdId), eq(diagnosisJobs.month, month))

async function expireAbandonedJobs(tx: Transaction, householdId: string, month: string, id?: string) {
  await tx.update(diagnosisJobs).set({ status: 'failed', errorCode: 'lease_expired', completedAt: sql`now()`, leaseExpiresAt: null, claimToken: null, workerId: null })
    .where(and(scope(householdId, month), id ? eq(diagnosisJobs.id, id) : undefined, eq(diagnosisJobs.status, 'running'), lt(diagnosisJobs.leaseExpiresAt, sql`now()`)))
}
function databaseError(error: unknown, codes: string[], names?: string[], seen = new Set<object>()): boolean {
  if (!error || typeof error !== 'object' || seen.has(error)) return false
  seen.add(error)
  const item = error as { code?: string; message?: string; cause?: unknown }
  return !!(item.code && codes.includes(item.code) && (!names || names.some(name => new RegExp(`\\b${name}\\b`).test(item.message ?? ''))))
    || databaseError(item.cause, codes, names, seen)
}
function missingPromptSchema(error: unknown) {
  return databaseError(error, ['42P01', '42703', '42883'], ['ai_diagnosis_settings', 'prompt_input', 'request_id', 'prompt_protocol_version', 'prompt_last_seen_at'])
}
function missingQueueSchema(error: unknown) {
  return databaseError(error, ['42P01'], ['diagnosis_jobs', 'diagnosis_workers'])
}
function jobView(job: Job): DiagnosisJobView {
  return { id: job.id, status: job.status, createdAt: job.createdAt.toISOString(), startedAt: job.startedAt?.toISOString() ?? null, completedAt: job.completedAt?.toISOString() ?? null, errorCode: job.errorCode }
}

function completedResult(row: Job, month: string): NonNullable<DiagnosisPageData['completed']> {
  if (!row.completedAt || row.snapshot.month !== month || row.snapshot.version !== 1) throw new Error('invalid_output')
  const promptInput = row.promptInput === null ? null : parseAiPromptInput(row.promptInput, 'ledger', row.snapshot)
  return { id: row.id, completedAt: row.completedAt.toISOString(), snapshot: row.snapshot, promptInput, report: parseDiagnosisReport(row.report, row.snapshot) }
}
async function readPageData(reader: AiSettingsReader, householdId: string, month: string, anchor?: Job, legacy = false): Promise<DiagnosisPageData> {
  const columns = getTableColumns(diagnosisJobs)
  const selection = { ...columns, ...(legacy ? { requestId: sql<null>`null`, promptInput: sql<null>`null` } : {}) }
  const [currentSnapshot, latestRows, completedRows, workers, aiSettings] = await Promise.all([
    readDiagnosisSnapshot(reader, householdId, month),
    anchor ? Promise.resolve([anchor]) : reader.select(selection).from(diagnosisJobs).where(scope(householdId, month))
      .orderBy(desc(diagnosisJobs.createdAt), desc(diagnosisJobs.id)).limit(1),
    reader.select(selection).from(diagnosisJobs).where(and(scope(householdId, month), eq(diagnosisJobs.status, 'completed'), anchor
      ? sql`${diagnosisJobs.completedAt} <= (select created_at from diagnosis_jobs where id = ${anchor.id}::uuid)` : undefined))
      .orderBy(desc(diagnosisJobs.completedAt), desc(diagnosisJobs.createdAt), desc(diagnosisJobs.id)),
    reader.select({ lastSeenAt: diagnosisWorkers.lastSeenAt,
      promptVersion: legacy ? sql<number>`0` : diagnosisWorkers.promptProtocolVersion }).from(diagnosisWorkers)
      .where(and(eq(diagnosisWorkers.householdId, householdId), isNull(diagnosisWorkers.revokedAt))),
    legacy ? Promise.resolve(null) : readAiSettings(reader, householdId),
  ])
  let completed: DiagnosisPageData['completed'] = null
  let completedFingerprint: string | null = null
  const candidates = anchor?.status === 'completed' ? [anchor, ...completedRows.filter(row => row.id !== anchor.id)] : completedRows
  for (const row of candidates) {
    if (row.status !== 'completed') continue
    try { completed = completedResult(row, month); completedFingerprint = row.fingerprint; break } catch { /* Keep preceding verified output. */ }
  }
  const latest = latestRows[0]
  const latestJob = latest ? jobView(latest) : null
  if (latestJob?.status === 'completed') {
    try { completedResult(latest, month) } catch { latestJob.status = 'failed'; latestJob.errorCode = 'invalid_output' }
  }
  return { month, latestJob, completed, currentSnapshot,
    isStale: completedFingerprint !== null && completedFingerprint !== diagnosisFingerprint(currentSnapshot),
    workerOnline: workers.some(worker => worker.lastSeenAt && worker.lastSeenAt.getTime() >= Date.now() - 90_000),
    setupRequired: workers.length === 0,
    promptSetupRequired: legacy || !workers.some(worker => worker.promptVersion >= 1),
    instructionsChanged: !!completed?.promptInput && !!aiSettings
      && completed.promptInput.instructionsHash !== aiInstructionsHash(resolveAiInstructions(aiSettings, 'ledger'), diagnosisPromptPolicy.version) }
}
export async function getDiagnosisPageData(householdId: string, month: string): Promise<DiagnosisPageData> {
  try {
    return await db.transaction(async tx => {
      await expireAbandonedJobs(tx, householdId, month)
      return readPageData(tx, householdId, month)
    }, { isolationLevel: 'repeatable read' })
  } catch (error) {
    if (missingPromptSchema(error)) {
      return db.transaction(tx => readPageData(tx, householdId, month, undefined, true), { isolationLevel: 'repeatable read', accessMode: 'read only' })
    }
    if (!missingQueueSchema(error)) throw error
    return { month, latestJob: null, completed: null, currentSnapshot: await getDiagnosisSnapshot(householdId, month), isStale: false,
      workerOnline: false, setupRequired: true, instructionsChanged: false, promptSetupRequired: true }
  }
}
async function exactRequest(reader: AiSettingsReader, householdId: string, requestId: string) {
  return (await reader.select().from(diagnosisJobs).where(and(eq(diagnosisJobs.householdId, householdId), eq(diagnosisJobs.requestId, requestId))).limit(1))[0]
}
export async function requestDiagnosis(householdId: string, userId: string, month: string, requestId?: string): Promise<DiagnosisPageData> {
  if (!isMonthKey(month)) throw new DiagnosisRequestError('조회할 월을 확인해주세요.')
  if (requestId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new DiagnosisRequestError('진단 요청을 확인해주세요.')
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.transaction(async tx => {
        if (requestId) {
          const existing = await exactRequest(tx, householdId, requestId)
          if (existing) {
            if (existing.month !== month) throw new DiagnosisRequestError('request_conflict', 409)
            await expireAbandonedJobs(tx, householdId, month, existing.id)
            return readPageData(tx, householdId, month, (await exactRequest(tx, householdId, requestId))!)
          }
        }
        await expireAbandonedJobs(tx, householdId, month)
        const [active] = await tx.select().from(diagnosisJobs).where(and(scope(householdId, month), inArray(diagnosisJobs.status, ['queued', 'running']))).limit(1)
        if (active) {
          if (requestId) throw new DiagnosisRequestError('active_job_exists', 409)
          return readPageData(tx, householdId, month, active)
        }
        const workers = await tx.select({ promptVersion: diagnosisWorkers.promptProtocolVersion }).from(diagnosisWorkers)
          .where(and(eq(diagnosisWorkers.householdId, householdId), isNull(diagnosisWorkers.revokedAt)))
        if (!workers.length) throw new DiagnosisRequestError('진단을 처리할 Mac을 먼저 연결해주세요.', 409)
        if (!workers.some(worker => worker.promptVersion >= 1)) throw new DiagnosisRequestError('진단을 처리할 Mac의 AI 작업기를 업데이트해주세요.', 409)
        const [snapshot, settings] = await Promise.all([readDiagnosisSnapshot(tx, householdId, month), readAiSettings(tx, householdId)])
        if (snapshot.current.count === 0) throw new DiagnosisRequestError('선택한 월에 진단할 기록이 없습니다.')
        const promptInput = buildDiagnosisPromptInput(snapshot, settings)
        const [job] = await tx.insert(diagnosisJobs).values({ householdId, requestedBy: userId, month, requestId, snapshot, promptInput, fingerprint: diagnosisFingerprint(snapshot), status: 'queued' }).returning()
        return readPageData(tx, householdId, month, job)
      }, { isolationLevel: 'repeatable read' })
    } catch (error) {
      if (databaseError(error, ['23505', '40001']) && attempt < 2) continue
      if (missingPromptSchema(error) || missingQueueSchema(error)) throw new DiagnosisRequestError('진단 설정을 업데이트해주세요.', 409)
      throw error
    }
  }
}
