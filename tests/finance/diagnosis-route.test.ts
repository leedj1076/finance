import { beforeEach, expect, test, vi } from 'vitest'

const context = vi.hoisted(() => ({ signedIn: true, get: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => context.signedIn ? { userId: 'session-user', householdId: 'session-household' } : null }))
vi.mock('@/features/diagnosis/queries', () => ({
  getDiagnosisPageData: (...args: unknown[]) => context.get(...args),
  requestDiagnosis: (...args: unknown[]) => context.request(...args),
  DiagnosisRequestError: class extends Error { constructor(message: string, public status = 400) { super(message) } },
}))
import { GET, POST } from '@/app/api/diagnosis/route'

beforeEach(() => { context.signedIn = true; context.get.mockReset().mockResolvedValue({ month: '2026-07' }); context.request.mockReset().mockResolvedValue({ month: '2026-07' }) })
const request = (body: unknown = { month: '2026-07' }, origin = 'https://ledger.example') => new Request('https://ledger.example/api/diagnosis', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('requires a signed-in household for both reads and requests', async () => {
  context.signedIn = false
  expect((await GET(new Request('https://ledger.example/api/diagnosis?month=2026-07'))).status).toBe(401)
  expect((await POST(request())).status).toBe(401)
  expect(context.get).not.toHaveBeenCalled()
  expect(context.request).not.toHaveBeenCalled()
})

test('rejects foreign origin and invalid month/body without processing jobs', async () => {
  expect((await POST(request({}, 'https://foreign.example'))).status).toBe(403)
  for (const body of [null, { month: 'invalid' }, { month: '2026-13' }, { month: '2026-07', householdId: 'foreign' }, { month: '2026-07', prompt: 'run command' }]) expect((await POST(request(body))).status).toBe(400)
  expect(context.request).not.toHaveBeenCalled()
})

test('uses only the session household and responds with no-store', async () => {
  const post = await POST(request())
  expect(post.status).toBe(200)
  expect(context.request).toHaveBeenCalledWith('session-household', 'session-user', '2026-07')
  expect(post.headers.get('Cache-Control')).toContain('no-store')
  expect((await GET(new Request('https://ledger.example/api/diagnosis?month=2026-07&householdId=foreign'))).status).toBe(200)
  expect(context.get).toHaveBeenCalledWith('session-household', '2026-07')
})

test('caps actual body bytes and never reflects exception secrets', async () => {
  expect((await POST(request({ month: 'x'.repeat(5000) }))).status).toBe(413)
  context.request.mockRejectedValue(new Error('private credential'))
  const result = await POST(request())
  expect(result.status).toBe(500)
  expect(await result.text()).not.toContain('private credential')
})
