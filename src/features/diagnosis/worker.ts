import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { parseAiPromptInput } from '@/features/ai-settings/prompt'
import { createBudgetRpcClient, processBudgetJob, type BudgetRpcClient } from '@/features/budget-recommendations/worker'
import { getDiagnosisErrorCode, runCodexDiagnosis, type CodexDiagnosisOptions } from './codex-runner'
import { processLeaseJob } from './lease-job'
import { DiagnosisRunnerError } from './structured-runner'
import {
  createConfiguredDiagnosisRpcClient,
  createWorkerRpcCaller,
  isMissingWorkerRpcError,
  type ConfiguredDiagnosisRpcClient,
} from './worker-rpc'
import type { ClaimedDiagnosisJob, DiagnosisErrorCode, DiagnosisReport, DiagnosisSnapshot } from './types'

export { createConfiguredDiagnosisRpcClient }
export type { ConfiguredDiagnosisRpcClient }

export type DiagnosisWorkerConfig = {
  supabaseUrl: string
  supabaseAnonKey: string
  workerToken: string
  codexPath: string
  model?: string
}

export type DiagnosisRpcClient = {
  claim(): Promise<ClaimedDiagnosisJob | null>
  heartbeat(job: ClaimedDiagnosisJob): Promise<boolean>
  finish(job: ClaimedDiagnosisJob, report: DiagnosisReport | null, code: DiagnosisErrorCode | null): Promise<boolean>
}

export type DiagnosisJobOptions = CodexDiagnosisOptions & {
  heartbeatMs?: number
  run?: (snapshot: DiagnosisSnapshot, options: CodexDiagnosisOptions) => Promise<DiagnosisReport>
}

export class DiagnosisWorkerError extends Error {
  constructor(readonly code: 'invalid_worker_config' | 'rpc_failed') {
    super(code)
    this.name = 'DiagnosisWorkerError'
  }
}

export function parseDiagnosisWorkerConfig(value: unknown): DiagnosisWorkerConfig {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    const config = value as Record<string, unknown>
    const allowed = ['supabaseUrl', 'supabaseAnonKey', 'workerToken', 'codexPath', 'model']
    if (Object.keys(config).some(key => !allowed.includes(key))) throw new Error()
    for (const key of allowed.slice(0, 4)) {
      if (typeof config[key] !== 'string' || !config[key] || (config[key] as string).trim() !== config[key]) throw new Error()
    }
    const typed = config as DiagnosisWorkerConfig
    const url = new URL(typed.supabaseUrl)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error()
    if (!isAbsolute(typed.codexPath) || typed.codexPath.includes('\0')) throw new Error()
    if (!/^[A-Za-z0-9_-]{32,512}$/.test(typed.workerToken)) throw new Error()
    if (typed.model !== undefined && (typeof typed.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(typed.model))) throw new Error()
    if (!typed.supabaseAnonKey.startsWith('sb_publishable_')) {
      const pieces = typed.supabaseAnonKey.split('.')
      if (pieces.length !== 3 || JSON.parse(Buffer.from(pieces[1], 'base64url').toString('utf8')).role !== 'anon') throw new Error()
    }
    return typed
  } catch {
    throw new DiagnosisWorkerError('invalid_worker_config')
  }
}

export async function loadDiagnosisWorkerConfig(path: string): Promise<DiagnosisWorkerConfig> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()) || stat.size > 16 * 1024) throw new Error()
      const buffer = Buffer.alloc(16 * 1024 + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      if (bytesRead > 16 * 1024) throw new Error()
      return parseDiagnosisWorkerConfig(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')))
    } finally {
      await file.close()
    }
  } catch {
    throw new DiagnosisWorkerError('invalid_worker_config')
  }
}

export function createDiagnosisRpcClient(config: DiagnosisWorkerConfig, fetcher: typeof fetch = fetch): DiagnosisRpcClient {
  parseDiagnosisWorkerConfig(config)
  const call = createWorkerRpcCaller(config, fetcher)
  const jobParams = (job: ClaimedDiagnosisJob) => ({ p_job_id: job.id, p_claim_token: job.claimToken })
  const booleanResult = (value: unknown) => {
    if (typeof value !== 'boolean') throw new DiagnosisWorkerError('rpc_failed')
    return value
  }
  return {
    async claim() {
      const value = await call('claim_diagnosis_job', {})
      if (value === null) return null
      const job = value as ClaimedDiagnosisJob
      if (!job || typeof job.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(job.id) || typeof job.claimToken !== 'string' || !job.claimToken || !job.snapshot || job.snapshot.version !== 1) {
        throw new DiagnosisWorkerError('rpc_failed')
      }
      return job
    },
    async heartbeat(job) {
      return booleanResult(await call('heartbeat_diagnosis_job', jobParams(job)))
    },
    async finish(job, report, code) {
      return booleanResult(await call('finish_diagnosis_job', { ...jobParams(job), p_report: report, p_error_code: code }))
    },
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function validDiagnosisSnapshot(snapshot: unknown): snapshot is DiagnosisSnapshot {
  if (!isPlainObject(snapshot) || snapshot.version !== 1
    || typeof snapshot.month !== 'string' || typeof snapshot.asOf !== 'string'
    || typeof snapshot.sourceHash !== 'string' || !isPlainObject(snapshot.current)
    || !Array.isArray(snapshot.months) || !isPlainObject(snapshot.comparison)
    || !Array.isArray(snapshot.categories) || !isPlainObject(snapshot.budget)
    || !Array.isArray(snapshot.transactions) || !Number.isSafeInteger(snapshot.evidenceCount)
    || (snapshot.evidenceCount as number) < 0) return false
  try {
    return Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= 1024 * 1024
  } catch {
    return false
  }
}

export async function processDiagnosisJob(job: ClaimedDiagnosisJob, rpc: DiagnosisRpcClient, options: DiagnosisJobOptions): Promise<'completed' | 'failed' | 'lease_lost'> {
  return processLeaseJob(job, rpc, {
    signal: options.signal,
    heartbeatMs: options.heartbeatMs,
    execute: async (signal) => {
      if (!validDiagnosisSnapshot(job.snapshot)) throw new DiagnosisRunnerError('invalid_output')
      if (Object.hasOwn(job, 'promptInput') && job.promptInput === undefined) {
        throw new DiagnosisRunnerError('invalid_output')
      }
      if (job.promptInput != null) parseAiPromptInput(job.promptInput, 'ledger', job.snapshot)
      return (options.run ?? runCodexDiagnosis)(job.snapshot, {
        codexPath: options.codexPath, model: options.model, timeoutMs: options.timeoutMs,
        signal, promptInput: job.promptInput,
      })
    },
    errorCode: (error) => error instanceof Error && error.message === 'invalid_ai_prompt'
      ? 'invalid_output'
      : getDiagnosisErrorCode(error),
  })
}

function delay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve()
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

export async function runDiagnosisWorker(config: DiagnosisWorkerConfig, options: {
  once?: boolean
  signal?: AbortSignal
  log?: (event: string, jobId?: string) => void
  rpc?: DiagnosisRpcClient
  run?: DiagnosisJobOptions['run']
  pollMs?: number
} = {}) {
  const rpc = options.rpc ?? createDiagnosisRpcClient(config)
  while (!options.signal?.aborted) {
    try {
      const job = await rpc.claim()
      if (job) {
        options.log?.('started', job.id)
        const outcome = await processDiagnosisJob(job, rpc, { codexPath: config.codexPath,
          model: config.model, signal: options.signal, run: options.run })
        options.log?.(outcome, job.id)
      } else if (options.once) options.log?.('idle')
    } catch {
      options.log?.('rpc_failed')
      if (options.once) throw new DiagnosisWorkerError('rpc_failed')
    }
    if (options.once) return
    await delay(options.pollMs ?? 10_000, options.signal)
  }
}

export function queueOrder(preferred: 'diagnosis' | 'budget') {
  return preferred === 'diagnosis'
    ? ['diagnosis', 'budget'] as const
    : ['budget', 'diagnosis'] as const
}

export async function runFinanceWorker(config: DiagnosisWorkerConfig, options: {
  once?: boolean
  signal?: AbortSignal
  pollMs?: number
  log?: (event: string, jobId?: string) => void
  diagnosisRpc?: ConfiguredDiagnosisRpcClient
  budgetRpc?: BudgetRpcClient
  diagnosisRun?: DiagnosisJobOptions['run']
  budgetRun?: typeof import('@/features/budget-recommendations/codex-runner').runCodexBudgetRecommendation
} = {}): Promise<void> {
  parseDiagnosisWorkerConfig(config)
  const diagnosisRpc = options.diagnosisRpc ?? createConfiguredDiagnosisRpcClient(config)
  const budgetRpc = options.budgetRpc ?? createBudgetRpcClient(config)
  let budgetAvailable = true
  let budgetSetupLogged = false
  let preferred: 'diagnosis' | 'budget' = 'diagnosis'
  let presence: Promise<boolean> | undefined
  let presenceTimer: ReturnType<typeof setTimeout> | undefined
  let active = true

  const refreshPresence = () => {
    if (presence) return presence
    presence = (async () => {
      if (!await diagnosisRpc.presence()) throw new DiagnosisWorkerError('rpc_failed')
      try {
        if (!await budgetRpc.presence()) throw new Error('unavailable')
        budgetAvailable = true
        budgetSetupLogged = false
      } catch {
        budgetAvailable = false
        if (!budgetSetupLogged) {
          options.log?.('budget_setup_required')
          budgetSetupLogged = true
        }
      }
      return true
    })().finally(() => { presence = undefined })
    return presence
  }
  const schedulePresence = () => {
    presenceTimer = setTimeout(() => {
      void refreshPresence().catch(() => options.log?.('rpc_failed')).finally(() => {
        if (active && !options.signal?.aborted) schedulePresence()
      })
    }, 30_000)
  }

  try {
    await refreshPresence()
    schedulePresence()
    while (!options.signal?.aborted) {
      let processed = false
      try {
        await refreshPresence()
        for (const kind of queueOrder(preferred)) {
          if (kind === 'budget' && !budgetAvailable) continue
          if (kind === 'diagnosis') {
            const job = await diagnosisRpc.claim()
            if (!job) continue
            processed = true
            options.log?.('started', job.id)
            const outcome = await processDiagnosisJob(job, diagnosisRpc, {
              codexPath: config.codexPath, model: config.model,
              signal: options.signal, run: options.diagnosisRun,
            })
            options.log?.(outcome, job.id)
            preferred = 'budget'
            break
          }
          let job
          try {
            job = await budgetRpc.claim()
          } catch (error) {
            if (isMissingWorkerRpcError(error)) {
              budgetAvailable = false
              if (!budgetSetupLogged) {
                options.log?.('budget_setup_required')
                budgetSetupLogged = true
              }
            } else {
              options.log?.('rpc_failed')
            }
            continue
          }
          if (!job) continue
          processed = true
          options.log?.('started', job.id)
          const outcome = await processBudgetJob(job, budgetRpc, {
            codexPath: config.codexPath, model: config.model,
            signal: options.signal, run: options.budgetRun,
          })
          options.log?.(outcome, job.id)
          preferred = 'diagnosis'
          break
        }
        if (!processed && options.once) options.log?.('idle')
      } catch {
        options.log?.('rpc_failed')
        if (options.once) throw new DiagnosisWorkerError('rpc_failed')
      }
      if (options.once) return
      if (!processed) await delay(options.pollMs ?? 10_000, options.signal)
    }
  } finally {
    active = false
    clearTimeout(presenceTimer)
    await presence?.catch(() => {})
  }
}
