import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { getDiagnosisErrorCode, runCodexDiagnosis, type CodexDiagnosisOptions } from './codex-runner'
import type { ClaimedDiagnosisJob, DiagnosisErrorCode, DiagnosisReport, DiagnosisSnapshot } from './types'

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

async function boundedResponse(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new DiagnosisWorkerError('rpc_failed')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > 2 * 1024 * 1024) throw new DiagnosisWorkerError('rpc_failed')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function createDiagnosisRpcClient(config: DiagnosisWorkerConfig, fetcher: typeof fetch = fetch): DiagnosisRpcClient {
  parseDiagnosisWorkerConfig(config)
  async function call(name: string, params: Record<string, unknown>) {
    try {
      const headers: Record<string, string> = { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' }
      // New publishable keys use apikey only; legacy anon JWTs also support Bearer auth.
      if (!config.supabaseAnonKey.startsWith('sb_publishable_')) headers.Authorization = `Bearer ${config.supabaseAnonKey}`
      const response = await fetcher(`${new URL(config.supabaseUrl).origin}/rest/v1/rpc/${name}`, {
        method: 'POST', headers, redirect: 'error', cache: 'no-store',
        body: JSON.stringify({ p_token: config.workerToken, ...params }),
        signal: AbortSignal.timeout(10_000),
      })
      return await boundedResponse(response)
    } catch {
      throw new DiagnosisWorkerError('rpc_failed')
    }
  }
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

export async function processDiagnosisJob(job: ClaimedDiagnosisJob, rpc: DiagnosisRpcClient, options: DiagnosisJobOptions): Promise<'completed' | 'failed' | 'lease_lost'> {
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
      heartbeat = rpc.heartbeat(job).then(valid => {
        if (!valid) { leaseLost = true; controller.abort() }
      }).catch(() => {
        // With uncertain ownership, stop computing and let the durable lease expire.
        leaseLost = true
        controller.abort()
      }).finally(() => {
        if (active && !leaseLost) scheduleHeartbeat()
      })
    }, options.heartbeatMs ?? 30_000)
  }
  scheduleHeartbeat()
  let report: DiagnosisReport | null = null
  let code: DiagnosisErrorCode | null = null
  try {
    report = await (options.run ?? runCodexDiagnosis)(job.snapshot, { codexPath: options.codexPath,
      model: options.model, timeoutMs: options.timeoutMs, signal: controller.signal })
  } catch (error) {
    code = options.signal?.aborted ? 'worker_stopped' : getDiagnosisErrorCode(error)
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
