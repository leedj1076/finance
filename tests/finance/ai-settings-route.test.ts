import { beforeEach, expect, test, vi } from 'vitest'

const context = vi.hoisted(() => ({
  signedIn: true,
  load: vi.fn(),
  save: vi.fn(),
  preview: vi.fn(),
  jobPrompt: vi.fn(),
}))

vi.mock('@/lib/household', () => ({
  requireHousehold: async () => context.signedIn
    ? { userId: 'session-user', householdId: 'session-household' }
    : null,
}))
vi.mock('@/features/ai-settings/service', () => ({
  getAiSettingsPageData: (...args: unknown[]) => context.load(...args),
  saveAiSettings: (...args: unknown[]) => context.save(...args),
}))
vi.mock('@/features/ai-settings/preview', () => ({
  previewAiPrompt: (...args: unknown[]) => context.preview(...args),
  getAiJobPrompt: (...args: unknown[]) => context.jobPrompt(...args),
}))

import { GET, POST } from '@/app/api/ai-settings/route'

const values = { commonInstructions: null, ledgerInstructions: '', budgetInstructions: '예산만' }
const request = (body: unknown, origin = 'http://localhost:3101', contentType = 'application/json') => new Request(
  'http://localhost:3101/api/ai-settings',
  { method: 'POST', headers: { origin, 'content-type': contentType }, body: JSON.stringify(body) },
)

beforeEach(() => {
  context.signedIn = true
  for (const mock of [context.load, context.save, context.preview, context.jobPrompt]) mock.mockReset()
  context.load.mockResolvedValue({ settings: { ...values, revision: 0, updatedAt: null }, defaults: {}, workers: [], budgetPreviewAvailable: true })
  context.save.mockResolvedValue({ ...values, revision: 1, updatedAt: '2026-09-10T00:00:00.000Z' })
  context.preview.mockResolvedValue({ kind: 'ledger', month: '2026-07' })
  context.jobPrompt.mockResolvedValue({ state: 'unrecorded', kind: 'ledger', month: '2026-07' })
})

test('GET and every action use only the authenticated household with private no-store responses', async () => {
  const get = await GET()
  expect(get.status).toBe(200)
  expect(context.load).toHaveBeenCalledWith('session-household')
  expect(get.headers.get('cache-control')).toContain('private')
  expect(get.headers.get('cache-control')).toContain('no-store')

  await POST(request({ action: 'save', settings: { ...values, expectedRevision: 0 } }))
  expect(context.save).toHaveBeenCalledWith('session-household', 'session-user', { ...values, expectedRevision: 0 })
  await POST(request({ action: 'preview', kind: 'ledger', month: '2026-07', values }))
  expect(context.preview).toHaveBeenCalledWith('session-household', { kind: 'ledger', month: '2026-07', values })
  await POST(request({ action: 'job-prompt', kind: 'ledger', jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }))
  expect(context.jobPrompt).toHaveBeenCalledWith('session-household', 'ledger', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
})

test('authentication, same-origin JSON and exact discriminated bodies are mandatory', async () => {
  context.signedIn = false
  expect((await GET()).status).toBe(401)
  expect((await POST(request({ action: 'save', settings: { ...values, expectedRevision: 0 } }))).status).toBe(401)
  context.signedIn = true

  expect((await POST(request({ action: 'save', settings: { ...values, expectedRevision: 0 } }, 'https://outside.invalid'))).status).toBe(403)
  expect((await POST(request({ action: 'save', settings: { ...values, expectedRevision: 0 } }, '', 'application/json'))).status).toBe(403)
  expect((await POST(request({ action: 'save', settings: { ...values, expectedRevision: 0 } }, 'http://localhost:3101', 'text/plain'))).status).toBe(400)

  const invalid = [
    { action: 'save', settings: { ...values, expectedRevision: 0 }, model: 'gpt-secret' },
    { action: 'save', settings: { ...values, expectedRevision: 0, householdId: 'foreign' } },
    { action: 'preview', kind: 'ledger', month: '2026-07', values, prefix: 'override' },
    { action: 'preview', kind: 'ledger', month: '2026-07', values, householdId: 'foreign' },
    { action: 'job-prompt', kind: 'ledger', jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', model: 'x' },
    { action: 'job-prompt', kind: 'ledger', jobId: 'not-a-uuid' },
    { action: 'execute', kind: 'ledger' },
  ]
  for (const body of invalid) expect((await POST(request(body))).status).toBe(400)
  expect(context.save).not.toHaveBeenCalled()
  expect(context.preview).not.toHaveBeenCalled()
  expect(context.jobPrompt).not.toHaveBeenCalled()
})

test('actual streamed bytes are capped at 128 KiB regardless of Content-Length', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ action: 'preview', kind: 'ledger', month: '2026-07', values: { ...values, commonInstructions: '가'.repeat(50_000) } }))
  const streamed = new Request('http://localhost:3101/api/ai-settings', {
    method: 'POST',
    headers: { origin: 'http://localhost:3101', 'content-type': 'application/json', 'content-length': '1' },
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 90_000)); controller.enqueue(bytes.slice(90_000)); controller.close() } }),
    duplex: 'half',
  } as RequestInit)
  expect((await POST(streamed)).status).toBe(413)
  expect(context.preview).not.toHaveBeenCalled()
})

test('foreign jobs stay indistinguishable from missing jobs and unexpected failures are redacted', async () => {
  context.jobPrompt.mockRejectedValueOnce(new Error('not_found'))
  const foreign = await POST(request({ action: 'job-prompt', kind: 'budget', jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }))
  expect(foreign.status).toBe(404)
  expect(await foreign.json()).toEqual({ error: 'not_found' })
  context.preview.mockRejectedValueOnce(new Error('private database credential'))
  const failed = await POST(request({ action: 'preview', kind: 'ledger', month: '2026-07', values }))
  expect(failed.status).toBe(500)
  expect(await failed.text()).not.toContain('private database credential')
})
