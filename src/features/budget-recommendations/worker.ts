import { parseAiPromptInput } from '@/features/ai-settings/prompt'
import { DiagnosisRunnerError, getDiagnosisErrorCode, type StructuredRunnerOptions } from '@/features/diagnosis/structured-runner'
import { createWorkerRpcCaller } from '@/features/diagnosis/worker-rpc'
import type { DiagnosisWorkerConfig } from '@/features/diagnosis/worker'
import type { DiagnosisErrorCode } from '@/features/diagnosis/types'

import { runCodexBudgetRecommendation } from './codex-runner'
import type { BudgetRecommendationReport, BudgetRecommendationSnapshot, ClaimedBudgetJob } from './types'

class BudgetRpcError extends Error {
  readonly code = 'rpc_failed'

  constructor() {
    super('rpc_failed')
  }
}

export type BudgetRpcClient = {
  presence(): Promise<boolean>
  claim(): Promise<ClaimedBudgetJob | null>
  heartbeat(job: ClaimedBudgetJob): Promise<boolean>
  finish(
    job: ClaimedBudgetJob,
    report: BudgetRecommendationReport | null,
    code: DiagnosisErrorCode | null,
  ): Promise<boolean>
}

function booleanResult(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BudgetRpcError()
  return value
}

function parseClaim(value: unknown): ClaimedBudgetJob | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BudgetRpcError()
  const job = value as Record<string, unknown>
  if (typeof job.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(job.id)
    || typeof job.claimToken !== 'string' || !job.claimToken
    || !job.snapshot || typeof job.snapshot !== 'object'
    || (job.snapshot as Record<string, unknown>).version !== 1) throw new BudgetRpcError()
  return value as ClaimedBudgetJob
}

export function createBudgetRpcClient(
  config: DiagnosisWorkerConfig,
  fetcher: typeof fetch = fetch,
): BudgetRpcClient {
  const call = createWorkerRpcCaller(config, fetcher)
  const params = (job: ClaimedBudgetJob) => ({ p_job_id: job.id, p_claim_token: job.claimToken })
  return {
    async presence() {
      return booleanResult(await call('heartbeat_budget_worker', {}))
    },
    async claim() {
      return parseClaim(await call('claim_budget_recommendation_job', {}))
    },
    async heartbeat(job) {
      return booleanResult(await call('heartbeat_budget_recommendation_job', params(job)))
    },
    async finish(job, report, code) {
      return booleanResult(await call('finish_budget_recommendation_job', {
        ...params(job), p_report: report, p_error_code: code,
      }))
    },
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function validSnapshot(snapshot: unknown): snapshot is BudgetRecommendationSnapshot {
  if (!isPlainObject(snapshot) || snapshot.version !== 1
    || typeof snapshot.month !== 'string' || typeof snapshot.sourceHash !== 'string'
    || typeof snapshot.budgetHash !== 'string' || typeof snapshot.fingerprint !== 'string'
    || !isPlainObject(snapshot.input) || !isPlainObject(snapshot.basis) || !isPlainObject(snapshot.current)
    || !Array.isArray(snapshot.rows) || !Array.isArray(snapshot.history)
    || !Array.isArray(snapshot.recurring) || !Array.isArray(snapshot.evidence)
    || !isPlainObject(snapshot.evidenceCount)) return false
  try {
    return Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= 1024 * 1024
  } catch {
    return false
  }
}

export async function processBudgetJob(
  job: ClaimedBudgetJob,
  rpc: BudgetRpcClient,
  options: StructuredRunnerOptions & {
    heartbeatMs?: number
    run?: typeof runCodexBudgetRecommendation
  },
): Promise<'completed' | 'failed' | 'lease_lost'> {
  const controller = new AbortController()
  const stop = () => controller.abort()
  options.signal?.addEventListener('abort', stop, { once: true })
  if (options.signal?.aborted) stop()
  let active = true
  let leaseLost = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: Promise<void> | undefined
  const scheduleHeartbeat = () => {
    timer = setTimeout(() => {
      heartbeat = rpc.heartbeat(job).then((valid) => {
        if (!valid) { leaseLost = true; controller.abort() }
      }).catch(() => {
        leaseLost = true
        controller.abort()
      }).finally(() => {
        if (active && !leaseLost) scheduleHeartbeat()
      })
    }, options.heartbeatMs ?? 30_000)
  }
  scheduleHeartbeat()
  let report: BudgetRecommendationReport | null = null
  let code: DiagnosisErrorCode | null = null
  try {
    if (!validSnapshot(job.snapshot)) throw new DiagnosisRunnerError('invalid_output')
    parseAiPromptInput(job.promptInput, 'budget', job.snapshot)
    report = await (options.run ?? runCodexBudgetRecommendation)(job.snapshot, {
      codexPath: options.codexPath, model: options.model, timeoutMs: options.timeoutMs,
      signal: controller.signal, promptInput: job.promptInput,
    })
  } catch (error) {
    code = options.signal?.aborted ? 'worker_stopped'
      : error instanceof DiagnosisRunnerError ? error.code
        : error instanceof Error && error.message === 'invalid_ai_prompt' ? 'invalid_output'
          : getDiagnosisErrorCode(error)
  } finally {
    active = false
    clearTimeout(timer)
    await heartbeat
    options.signal?.removeEventListener('abort', stop)
  }
  if (leaseLost) return 'lease_lost'
  try {
    if (!await rpc.heartbeat(job)) return 'lease_lost'
  } catch {
    return 'lease_lost'
  }
  if (options.signal?.aborted) { report = null; code = 'worker_stopped' }
  const completed = await rpc.finish(job, report, code)
  return completed ? (code ? 'failed' : 'completed') : 'lease_lost'
}
