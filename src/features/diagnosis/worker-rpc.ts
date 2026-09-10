import type { DiagnosisWorkerConfig, DiagnosisRpcClient } from './worker'
import type { ClaimedDiagnosisJob } from './types'
import { structuredTimeoutMs } from './structured-runner'

const MAX_RPC_BYTES = 2 * 1024 * 1024
const JOB_ID = /^[a-zA-Z0-9-]{1,80}$/

class WorkerRpcError extends Error {
  readonly code = 'rpc_failed'

  constructor() {
    super('rpc_failed')
    this.name = 'DiagnosisWorkerError'
  }
}

class MissingWorkerRpcError extends WorkerRpcError {}

async function boundedResponse(response: Response): Promise<unknown> {
  if (response.status === 404) throw new MissingWorkerRpcError()
  if (!response.ok || !response.body) throw new WorkerRpcError()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > MAX_RPC_BYTES) throw new WorkerRpcError()
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    if (error instanceof MissingWorkerRpcError) throw error
    throw new WorkerRpcError()
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function createWorkerRpcCaller(
  config: DiagnosisWorkerConfig,
  fetcher: typeof fetch = fetch,
): (name: string, params: Record<string, unknown>) => Promise<unknown> {
  return async (name, params) => {
    try {
      const headers: Record<string, string> = {
        apikey: config.supabaseAnonKey,
        'Content-Type': 'application/json',
      }
      if (!config.supabaseAnonKey.startsWith('sb_publishable_')) {
        headers.Authorization = `Bearer ${config.supabaseAnonKey}`
      }
      const response = await fetcher(`${new URL(config.supabaseUrl).origin}/rest/v1/rpc/${name}`, {
        method: 'POST', headers, redirect: 'error', cache: 'no-store',
        body: JSON.stringify({ p_token: config.workerToken, ...params }),
        signal: AbortSignal.timeout(10_000),
      })
      return await boundedResponse(response)
    } catch (error) {
      if (error instanceof MissingWorkerRpcError) throw error
      throw new WorkerRpcError()
    }
  }
}

function booleanResult(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new WorkerRpcError()
  return value
}

function parseDiagnosisClaim(value: unknown, configured: boolean): ClaimedDiagnosisJob | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkerRpcError()
  const job = value as Record<string, unknown>
  if (typeof job.id !== 'string' || !JOB_ID.test(job.id)
    || typeof job.claimToken !== 'string' || !job.claimToken
    || !job.snapshot || typeof job.snapshot !== 'object'
    || (job.snapshot as Record<string, unknown>).version !== 1) {
    throw new WorkerRpcError()
  }
  if (configured && !Object.hasOwn(job, 'promptInput')) {
    return { ...(value as ClaimedDiagnosisJob), promptInput: undefined }
  }
  return value as ClaimedDiagnosisJob
}

export type ConfiguredDiagnosisRpcClient = DiagnosisRpcClient & {
  presence(): Promise<boolean>
}

export function createConfiguredDiagnosisRpcClient(
  config: DiagnosisWorkerConfig,
  fetcher: typeof fetch = fetch,
): ConfiguredDiagnosisRpcClient {
  const call = createWorkerRpcCaller(config, fetcher)
  const params = (job: ClaimedDiagnosisJob) => ({ p_job_id: job.id, p_claim_token: job.claimToken })
  return {
    async presence() {
      try {
        return booleanResult(await call('heartbeat_ai_worker', {
          p_model: config.model ?? null,
          p_timeout_ms: structuredTimeoutMs(),
        }))
      } catch (error) {
        // Pre-migration workers can continue claiming only legacy null-input jobs.
        if (error instanceof MissingWorkerRpcError) return true
        throw error
      }
    },
    async claim() {
      try {
        return parseDiagnosisClaim(await call('claim_configured_diagnosis_job', {}), true)
      } catch (error) {
        if (!(error instanceof MissingWorkerRpcError)) throw error
        return parseDiagnosisClaim(await call('claim_diagnosis_job', {}), false)
      }
    },
    async heartbeat(job) {
      return booleanResult(await call('heartbeat_diagnosis_job', params(job)))
    },
    async finish(job, report, code) {
      return booleanResult(await call('finish_diagnosis_job', {
        ...params(job), p_report: report, p_error_code: code,
      }))
    },
  }
}
