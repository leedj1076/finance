import { beforeEach, expect, test, vi } from 'vitest'

const context = vi.hoisted(() => ({ signedIn: true, get: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => context.signedIn ? { userId: 'session-user', householdId: 'session-household' } : null }))
vi.mock('@/features/budget-recommendations/service', () => ({
  getBudgetRecommendationData: (...args: unknown[]) => context.get(...args),
  requestBudgetRecommendation: (...args: unknown[]) => context.request(...args),
  BudgetRecommendationError: class extends Error { constructor(public code: string, public status = 400) { super(code) } },
}))
import { GET, POST } from '@/app/api/budget-recommendations/route'
import { BudgetRecommendationError } from '@/features/budget-recommendations/service'

const input = { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', month: '2026-10', notes: '', plannedExpenses: [], draftAmounts: [] }
const request = (body: unknown = input, origin = 'http://localhost:3101', contentType = 'application/json') => new Request('http://localhost:3101/api/budget-recommendations', { method: 'POST', headers: { origin, 'content-type': contentType }, body: JSON.stringify(body) })
beforeEach(() => { context.signedIn = true; context.get.mockReset().mockResolvedValue({ month: '2026-10' }); context.request.mockReset().mockResolvedValue({ month: '2026-10' }) })

test('uses authenticated ownership and accepts normalized exact input', async () => {
  const response = await POST(request())
  expect(response.status).toBe(200)
  expect(context.request).toHaveBeenCalledWith('session-household', 'session-user', input)
  expect(response.headers.get('cache-control')).toContain('no-store')
})
test('requires authentication on GET and POST', async () => {
  context.signedIn = false
  expect((await GET(new Request('http://localhost:3101/api/budget-recommendations?month=2026-10'))).status).toBe(401)
  expect((await POST(request())).status).toBe(401)
  expect(context.request).not.toHaveBeenCalled()
})
test('blocks foreign or missing origin, non-JSON and unknown request fields', async () => {
  expect((await POST(request(input, 'https://outside.invalid'))).status).toBe(403)
  expect((await POST(request(input, ''))).status).toBe(403)
  expect((await POST(request(input, 'http://localhost:3101', 'text/plain'))).status).toBe(400)
  for (const body of [null, { ...input, householdId: 'foreign' }, { ...input, model: 'other' }, { ...input, month: '2026-13' }, { ...input, requestId: 'bad' }]) expect((await POST(request(body))).status).toBe(400)
  expect(context.request).not.toHaveBeenCalled()
})
test('caps streamed UTF-8 bytes independently of Content-Length', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...input, notes: '가'.repeat(50000) }))
  const streamed = new Request('http://localhost:3101/api/budget-recommendations', { method: 'POST', headers: { origin: 'http://localhost:3101', 'content-type': 'application/json', 'content-length': '1' }, body: new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 90000)); controller.enqueue(bytes.slice(90000)); controller.close() } }), duplex: 'half' } as RequestInit)
  expect((await POST(streamed)).status).toBe(413)
  expect(context.request).not.toHaveBeenCalled()
})
test('GET allows historical months and rejects missing or duplicate months', async () => {
  expect((await GET(new Request('http://localhost:3101/api/budget-recommendations?month=2020-01'))).status).toBe(200)
  expect(context.get).toHaveBeenCalledWith('session-household', '2020-01')
  for (const query of ['', '?month=2026-13', '?month=2026-09&month=2026-10']) expect((await GET(new Request(`http://localhost:3101/api/budget-recommendations${query}`))).status).toBe(400)
})
test('returns safe service codes and redacts unexpected failures', async () => {
  context.request.mockRejectedValueOnce(new BudgetRecommendationError('active_job_exists', 409))
  const conflict = await POST(request())
  expect(conflict.status).toBe(409)
  expect(await conflict.json()).toEqual({ error: 'active_job_exists' })
  context.request.mockRejectedValueOnce(new Error('private credential'))
  const failed = await POST(request())
  expect(failed.status).toBe(500)
  expect(await failed.text()).not.toContain('private credential')
})
