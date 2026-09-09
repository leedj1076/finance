import 'server-only'

import { createHash } from 'node:crypto'
import { and, asc, desc, eq, exists, gte, inArray, isNull, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { budgets, categories, diagnosisJobs, diagnosisWorkers, settings, transactions } from '@/db/schema'
import { isMonthKey, monthBounds, shiftMonth } from '@/lib/finance'
import { parseDiagnosisReport } from './report'
import { buildDiagnosisSnapshot, diagnosisFingerprint } from './snapshot'
import type { DiagnosisJobView, DiagnosisPageData } from './types'

export class DiagnosisRequestError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export async function getDiagnosisSnapshot(householdId: string, month: string) {
  if (!isMonthKey(month)) throw new DiagnosisRequestError('조회할 월을 확인해주세요.')
  const { end } = monthBounds(month)
  const [rows, budgetRows, target] = await Promise.all([
    db.select({ id: transactions.id, date: transactions.date, flow: transactions.flow, amount: transactions.amount, major: categories.major, sub: categories.sub, categoryId: transactions.categoryId, accountId: transactions.accountId, fixed: transactions.fixed, rawMerchant: transactions.rawMerchant, memo: transactions.memo })
      .from(transactions)
      .leftJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)))
      .where(and(eq(transactions.householdId, householdId), gte(transactions.date, `${shiftMonth(month, -3)}-01`), lt(transactions.date, end)))
      .orderBy(asc(transactions.date), asc(transactions.id)),
    db.select({ major: budgets.major, month: budgets.month, amount: budgets.amount }).from(budgets)
      .where(and(eq(budgets.householdId, householdId), inArray(budgets.month, ['*', month]),
        exists(db.select({ id: categories.id }).from(categories).where(and(eq(categories.householdId, householdId), eq(categories.major, budgets.major), eq(categories.kind, 'expense'), eq(categories.hidden, false)))),
      )),
    db.select({ value: settings.value }).from(settings)
      .where(and(eq(settings.householdId, householdId), eq(settings.key, 'savings_target'))).limit(1),
  ])
  return buildDiagnosisSnapshot({ month, budgetRows, savingsRateTarget: target[0]?.value?.trim() ? Number(target[0].value) : null,
    sourceRevision: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    rows: rows.map(row => ({ id: row.id, date: row.date, flow: row.flow, amount: row.amount, major: row.major ?? '미분류', sub: row.sub ?? '', merchant: (row.rawMerchant || row.memo || row.major || '미분류').replace(/[\u0000-\u001f]/g, ' ').slice(0, 240), memo: (row.memo ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 500) })),
  })
}

async function expireAbandonedJobs(householdId: string, month: string) {
  await db.update(diagnosisJobs).set({ status: 'failed', errorCode: 'lease_expired', completedAt: new Date(), leaseExpiresAt: null, claimToken: null })
    .where(and(eq(diagnosisJobs.householdId, householdId), eq(diagnosisJobs.month, month), eq(diagnosisJobs.status, 'running'), lt(diagnosisJobs.leaseExpiresAt, sql`now()`)))
}

function missingQueueSchema(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const item = error as { code?: string; cause?: unknown }
  return item.code === '42P01' || (item.cause !== error && missingQueueSchema(item.cause))
}

function jobView(job: typeof diagnosisJobs.$inferSelect): DiagnosisJobView {
  return { id: job.id, status: job.status, createdAt: job.createdAt.toISOString(), startedAt: job.startedAt?.toISOString() ?? null, completedAt: job.completedAt?.toISOString() ?? null, errorCode: job.errorCode }
}

export async function getDiagnosisPageData(householdId: string, month: string): Promise<DiagnosisPageData> {
  const currentSnapshot = await getDiagnosisSnapshot(householdId, month)
  try {
    await expireAbandonedJobs(householdId, month)
    const [latest, completedRows, workers] = await Promise.all([
      db.select().from(diagnosisJobs).where(and(eq(diagnosisJobs.householdId, householdId), eq(diagnosisJobs.month, month))).orderBy(desc(diagnosisJobs.createdAt), desc(diagnosisJobs.id)).limit(1),
      db.select().from(diagnosisJobs).where(and(eq(diagnosisJobs.householdId, householdId), eq(diagnosisJobs.month, month), eq(diagnosisJobs.status, 'completed'))).orderBy(desc(diagnosisJobs.completedAt), desc(diagnosisJobs.createdAt)).limit(5),
      db.select({ lastSeenAt: diagnosisWorkers.lastSeenAt }).from(diagnosisWorkers).where(and(eq(diagnosisWorkers.householdId, householdId), isNull(diagnosisWorkers.revokedAt))),
    ])
    // Worker output is independently checked when read as well as when written.
    let completed: DiagnosisPageData['completed'] = null
    let completedFingerprint: string | null = null
    for (const row of completedRows) {
      try {
        if (!row.completedAt || row.snapshot.month !== month || row.snapshot.version !== 1) continue
        completed = { id: row.id, completedAt: row.completedAt.toISOString(), snapshot: row.snapshot, report: parseDiagnosisReport(row.report, row.snapshot) }
        completedFingerprint = row.fingerprint
        break
      } catch { /* Keep the last well-formed report if a malformed result exists. */ }
    }
    const latestJob = latest[0] ? jobView(latest[0]) : null
    if (latestJob?.status === 'completed' && latestJob.id !== completed?.id) {
      latestJob.status = 'failed'
      latestJob.errorCode = 'invalid_output'
    }
    return { month, latestJob, completed, currentSnapshot, isStale: completedFingerprint !== null && completedFingerprint !== diagnosisFingerprint(currentSnapshot), workerOnline: workers.some(worker => worker.lastSeenAt && worker.lastSeenAt.getTime() >= Date.now() - 90_000), setupRequired: workers.length === 0 }
  } catch (error) {
    if (!missingQueueSchema(error)) throw error
    return { month, latestJob: null, completed: null, currentSnapshot, isStale: false, workerOnline: false, setupRequired: true }
  }
}

export async function requestDiagnosis(householdId: string, userId: string, month: string): Promise<DiagnosisPageData> {
  const state = await getDiagnosisPageData(householdId, month)
  if (state.setupRequired) throw new DiagnosisRequestError('진단을 처리할 Mac을 먼저 연결해주세요.', 409)
  if (state.currentSnapshot.current.count === 0) throw new DiagnosisRequestError('선택한 월에 진단할 기록이 없습니다.')
  if (state.latestJob?.status === 'queued' || state.latestJob?.status === 'running') return state
  const snapshot = state.currentSnapshot
  await db.insert(diagnosisJobs).values({ householdId, requestedBy: userId, month, snapshot, fingerprint: diagnosisFingerprint(snapshot), status: 'queued' }).onConflictDoNothing()
  return getDiagnosisPageData(householdId, month)
}
