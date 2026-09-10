import { afterEach, describe, expect, test, vi } from 'vitest'

import { requestDiagnosisPageData, startDiagnosisPolling } from '@/features/diagnosis/client'

const waiting = { month: '2026-07', currentSnapshot: {}, latestJob: { status: 'queued' } }
const completed = { ...waiting, latestJob: { status: 'completed' } }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('diagnosis client requests', () => {
  test('carries one explicit request ID in POST only', async () => {
    const fetcher = vi.fn().mockImplementation(async () => response(waiting))
    vi.stubGlobal('fetch', fetcher)
    const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await requestDiagnosisPageData('2026-07', 'POST', new AbortController().signal, requestId)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ month: '2026-07', requestId })
    await requestDiagnosisPageData('2026-07', 'GET', new AbortController().signal, requestId)
    expect(fetcher.mock.calls[1][1].body).toBeUndefined()
  })
  test('posts only the chosen month and rejects a response for another month', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(waiting)).mockResolvedValueOnce(response({ ...waiting, month: '2026-06' }))
    vi.stubGlobal('fetch', fetcher)
    await expect(requestDiagnosisPageData('2026-07', 'POST', new AbortController().signal)).resolves.toEqual(waiting)
    expect(fetcher.mock.calls[0][0]).toBe('/api/diagnosis?month=2026-07')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ month: '2026-07' }), cache: 'no-store' })
    await expect(requestDiagnosisPageData('2026-07', 'GET', new AbortController().signal)).rejects.toThrow('진단 상태를 불러오지 못했어요.')
  })

  test('presents a readable failure for a non-JSON response instead of parser internals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>error</html>', { status: 502 })))
    await expect(requestDiagnosisPageData('2026-07', 'GET', new AbortController().signal)).rejects.toThrow('진단 상태를 불러오지 못했어요.')
  })
})

describe('diagnosis status polling', () => {
  test('waits five seconds, backs off on network errors, and stops after completion', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockResolvedValueOnce(response(waiting)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(completed))
    vi.stubGlobal('fetch', fetcher)
    const onData = vi.fn()
    const onError = vi.fn()
    const stop = startDiagnosisPolling({ month: '2026-07', onData, onError })
    await vi.advanceTimersByTimeAsync(4999)
    expect(onData).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onData).toHaveBeenLastCalledWith(waiting)
    await vi.advanceTimersByTimeAsync(5000)
    expect(onError).toHaveBeenCalledOnce()
    expect(onData).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(9999)
    expect(onData).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(onData).toHaveBeenLastCalledWith(completed)
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetcher).toHaveBeenCalledTimes(3)
    stop()
  })

  test('aborts an in-flight request on month navigation and ignores its late response', async () => {
    vi.useFakeTimers()
    let resolveResponse: (value: Response) => void = () => {}
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveResponse = resolve }))
    vi.stubGlobal('fetch', fetcher)
    const onData = vi.fn()
    const onError = vi.fn()
    const stop = startDiagnosisPolling({ month: '2026-07', onData, onError, immediate: true })
    await vi.advanceTimersByTimeAsync(0)
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal
    stop()
    expect(signal.aborted).toBe(true)
    resolveResponse(response(completed))
    await vi.advanceTimersByTimeAsync(60000)
    expect(onData).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
