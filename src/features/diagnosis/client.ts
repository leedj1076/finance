import type { DiagnosisPageData } from './types'

const REQUEST_ERROR = '진단 상태를 불러오지 못했어요.'

export async function requestDiagnosisPageData(month: string, method: 'GET' | 'POST', signal: AbortSignal, requestId?: string): Promise<DiagnosisPageData> {
  const response = await fetch(`/api/diagnosis?month=${encodeURIComponent(month)}`, {
    method,
    cache: 'no-store',
    signal,
    ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, ...(requestId === undefined ? {} : { requestId }) }) } : {}),
  })
  const result: unknown = await response.json().catch(() => { throw new Error(REQUEST_ERROR) })
  if (!result || typeof result !== 'object') throw new Error(REQUEST_ERROR)
  if (!response.ok) throw new Error('error' in result && typeof result.error === 'string' ? result.error : REQUEST_ERROR)
  if (!('month' in result) || result.month !== month || !('currentSnapshot' in result) || !result.currentSnapshot) throw new Error(REQUEST_ERROR)
  return result as DiagnosisPageData
}

export function startDiagnosisPolling({ month, onData, onError, immediate = false }: {
  month: string
  onData: (data: DiagnosisPageData) => void
  onError: () => void
  immediate?: boolean
}) {
  let stopped = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout>
  let requestTimeout: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | null = null

  async function poll() {
    const requestController = new AbortController()
    controller = requestController
    requestTimeout = setTimeout(() => requestController.abort(), 15000)
    try {
      const next = await requestDiagnosisPageData(month, 'GET', requestController.signal)
      if (stopped) return
      onData(next)
      failures = 0
      if (next.latestJob?.status !== 'queued' && next.latestJob?.status !== 'running') return
    } catch {
      if (stopped) return
      failures += 1
      onError()
    } finally {
      clearTimeout(requestTimeout)
    }
    if (!stopped) timer = setTimeout(poll, Math.min(5000 * 2 ** failures, 30000))
  }

  timer = setTimeout(poll, immediate ? 0 : 5000)
  return () => {
    stopped = true
    clearTimeout(timer)
    clearTimeout(requestTimeout)
    controller?.abort()
  }
}
