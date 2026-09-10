import { afterEach, describe, expect, test, vi } from 'vitest'

import { evaluateBudget } from '@/features/budget-recommendations/calculations'
import {
  checkRecommendationForApply,
  getBudgetRecommendations,
  pollBudgetRecommendations,
  startBudgetRecommendation,
} from '@/features/budget-recommendations/client'
import type { BudgetRecommendationData, BudgetRequest } from '@/features/budget-recommendations/types'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const rerunRequestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function data(status: 'queued' | 'running' | 'completed' | 'failed' = 'completed'): BudgetRecommendationData {
  const snapshot = makeBudgetSnapshot()
  const report = makeBudgetReport()
  return {
    month: '2026-09',
    latestJob: { id: requestId, status, errorCode: status === 'failed' ? 'timeout' : null },
    completed: {
      id: requestId,
      completedAt: '2026-09-10T01:00:00Z',
      snapshot,
      promptInput: null,
      report,
      evaluation: evaluateBudget(snapshot, report.rows),
    },
    worker: 'ready',
    availability: 'available',
    freshness: 'current',
    instructionsChanged: false,
  }
}

function request(id = requestId): BudgetRequest {
  return { requestId: id, month: '2026-09', notes: '', plannedExpenses: [], draftAmounts: [] }
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('budget recommendation requests', () => {
  test('uses no-store requests, validates the requested month, and retains a previous completion while queued', async () => {
    const waiting = data('queued')
    const fetcher = vi.fn().mockResolvedValueOnce(response(waiting))
      .mockResolvedValueOnce(response({ ...waiting, month: '2026-08' }))
    vi.stubGlobal('fetch', fetcher)

    await expect(getBudgetRecommendations('2026-09')).resolves.toEqual(waiting)
    expect(fetcher.mock.calls[0][0]).toBe('/api/budget-recommendations?month=2026-09')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store' })
    await expect(getBudgetRecommendations('2026-09')).rejects.toThrow('request_failed')
  })

  test('posts the unchanged request ID for an explicit retry and uses a new caller-supplied ID for rerun', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response(data())))
    vi.stubGlobal('fetch', fetcher)

    await startBudgetRecommendation(request())
    await startBudgetRecommendation(request())
    await startBudgetRecommendation(request(rerunRequestId))

    const bodies = fetcher.mock.calls.map((call) => JSON.parse(String(call[1].body)) as BudgetRequest)
    expect(bodies.map((body) => body.requestId)).toEqual([requestId, requestId, rerunRequestId])
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    })
  })

  test('combines caller cancellation with the request and ignores a late response', async () => {
    let resolveResponse!: (value: Response) => void
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      resolveResponse = resolve
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()

    const pending = getBudgetRecommendations('2026-09', controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    resolveResponse(response(data()))
    expect(fetcher).toHaveBeenCalledOnce()
  })

  test('times out at 15 seconds without changing the UUID used by an explicit retry', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)

    const first = startBudgetRecommendation(request())
    const firstRejection = expect(first).rejects.toThrow('request_timeout')
    await vi.advanceTimersByTimeAsync(15_000)
    await firstRejection

    const retry = startBudgetRecommendation(request())
    const retryRejection = expect(retry).rejects.toThrow('request_timeout')
    await vi.advanceTimersByTimeAsync(15_000)
    await retryRejection

    expect(fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).requestId))
      .toEqual([requestId, requestId])
  })

  test('allowlists server codes and never exposes an unknown response body', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ error: 'active_job_exists' }, 409))
      .mockResolvedValueOnce(response({ error: 'past_or_distant_month' }, 400))
      .mockResolvedValueOnce(response({ error: 'private database detail', prompt: 'secret' }, 500))
    vi.stubGlobal('fetch', fetcher)

    await expect(getBudgetRecommendations('2026-09')).rejects.toThrow('active_job_exists')
    await expect(getBudgetRecommendations('2026-09')).rejects.toThrow('past_or_distant_month')
    await expect(getBudgetRecommendations('2026-09')).rejects.toThrow('request_failed')
  })

  test('reparses completed reports while accepting additive snapshot baseline fields', async () => {
    const valid = data()
    const withBaseline = {
      ...valid,
      completed: {
        ...valid.completed!,
        snapshot: {
          ...valid.completed!.snapshot,
          budgetState: { month: '2026-09', current: [], previous: [] },
        },
      },
    }
    const invalid = structuredClone(valid)
    invalid.completed!.report.rows[0].amount = 1
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(withBaseline))
      .mockResolvedValueOnce(response(invalid)))

    await expect(getBudgetRecommendations('2026-09')).resolves.toMatchObject({ month: '2026-09' })
    await expect(getBudgetRecommendations('2026-09')).rejects.toThrow('request_failed')
  })
})

describe('budget recommendation polling', () => {
  test('ignores data for an old month after the awaited poll request resolves', async () => {
    vi.useFakeTimers()
    const onData = vi.fn()
    const onError = vi.fn()
    const fetchData = vi.fn().mockResolvedValue({ ...data('completed'), month: '2026-08' })
    const controller = new AbortController()
    const polling = pollBudgetRecommendations('2026-09', {
      signal: controller.signal, onData, onError, fetchData, intervalMs: 5_000,
    })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(onData).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('request_failed')
    expect(fetchData).toHaveBeenCalledOnce()
    controller.abort()
    await polling
  })

  test('keeps one request active at a time and stops after terminal data is delivered', async () => {
    vi.useFakeTimers()
    let resolveFirst!: (value: BudgetRecommendationData) => void
    const fetchData = vi.fn()
      .mockImplementationOnce(() => new Promise<BudgetRecommendationData>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(data('completed'))
    const onData = vi.fn()
    const controller = new AbortController()
    const polling = pollBudgetRecommendations('2026-09', {
      signal: controller.signal, onData, onError: vi.fn(), fetchData, intervalMs: 5_000,
    })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchData).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchData).toHaveBeenCalledOnce()
    resolveFirst(data('running'))
    await vi.advanceTimersByTimeAsync(0)
    expect(onData).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(5_000)
    await polling
    expect(fetchData).toHaveBeenCalledTimes(2)
    expect(onData).toHaveBeenLastCalledWith(data('completed'))
  })

  test('reports a non-destructive inline error, backs off, and preserves prior successful data', async () => {
    vi.useFakeTimers()
    const prior = data('running')
    const terminal = data('failed')
    const fetchData = vi.fn()
      .mockResolvedValueOnce(prior)
      .mockRejectedValueOnce(new Error('private network detail'))
      .mockResolvedValueOnce(terminal)
    const onData = vi.fn()
    const onError = vi.fn()
    const polling = pollBudgetRecommendations('2026-09', {
      signal: new AbortController().signal, onData, onError, fetchData, intervalMs: 5_000,
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(onData).toHaveBeenLastCalledWith(prior)
    expect(onError).toHaveBeenCalledWith('request_failed')
    await vi.advanceTimersByTimeAsync(9_999)
    expect(fetchData).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await polling
    expect(onData.mock.calls).toEqual([[prior], [terminal]])
  })

  test('abort clears polling delays and ignores a response that arrives late', async () => {
    vi.useFakeTimers()
    let resolveFetch!: (value: BudgetRecommendationData) => void
    const fetchData = vi.fn(() => new Promise<BudgetRecommendationData>((resolve) => { resolveFetch = resolve }))
    const onData = vi.fn()
    const onError = vi.fn()
    const controller = new AbortController()
    const polling = pollBudgetRecommendations('2026-09', {
      signal: controller.signal, onData, onError, fetchData, intervalMs: 5_000,
    })

    await vi.advanceTimersByTimeAsync(5_000)
    controller.abort()
    resolveFetch(data('completed'))
    await polling
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onData).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(fetchData).toHaveBeenCalledOnce()
  })
})

describe('apply freshness recovery', () => {
  test.each(['current', 'applied'] as const)('returns the matching verified completion when freshness is %s', async (freshness) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...data(), freshness })))
    await expect(checkRecommendationForApply('2026-09', requestId)).resolves.toMatchObject({ id: requestId })
  })

  test.each([
    ['changed completion', { ...data(), completed: { ...data().completed!, id: rerunRequestId } }, 'invalid_result'],
    ['source changed', { ...data(), freshness: 'source_changed' as const }, 'source_changed'],
    ['budgets changed', { ...data(), freshness: 'budgets_changed' as const }, 'budgets_changed'],
  ])('rejects %s before apply', async (_name, value, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(value)))
    await expect(checkRecommendationForApply('2026-09', requestId)).rejects.toThrow(code)
  })

  test('maps aggregate overflow in a completed response to invalid_result before apply', async () => {
    const malformed = structuredClone(data())
    malformed.completed!.snapshot.current.unallocatedActual = 1
    malformed.completed!.report.rows[0].amount = Number.MAX_SAFE_INTEGER
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(malformed)))

    await expect(checkRecommendationForApply('2026-09', requestId)).rejects.toThrow('invalid_result')
  })
})
