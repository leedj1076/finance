import type { DiagnosisErrorCode } from './types'

export type LeaseJobRpc<Job, Report> = {
  heartbeat(job: Job): Promise<boolean>
  finish(job: Job, report: Report | null, code: DiagnosisErrorCode | null): Promise<boolean>
}

export async function processLeaseJob<Job, Report>(
  job: Job,
  rpc: LeaseJobRpc<Job, Report>,
  options: {
    signal?: AbortSignal
    heartbeatMs?: number
    execute(signal: AbortSignal): Promise<Report>
    errorCode(error: unknown): DiagnosisErrorCode
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
        if (!valid) {
          leaseLost = true
          controller.abort()
        }
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

  let report: Report | null = null
  let code: DiagnosisErrorCode | null = null
  try {
    report = await options.execute(controller.signal)
  } catch (error) {
    code = options.signal?.aborted ? 'worker_stopped' : options.errorCode(error)
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
  if (options.signal?.aborted) {
    report = null
    code = 'worker_stopped'
  }
  const finished = await rpc.finish(job, report, code)
  return finished ? (code ? 'failed' : 'completed') : 'lease_lost'
}
