import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { POST } from '@/app/api/import/route'
import { ImportFailure, type ImportObserver, type ImportResult } from '@/features/inbox/import-progress'
import { readImportStream } from '@/features/inbox/import-stream'

const context = vi.hoisted(() => ({
  signedIn: true,
  preflightError: null as Error | null,
  run: (async () => ({ message: '완료', added: 0, alreadyProcessed: 0, automatic: 0, review: 0 })) as (householdId: string, mode: string, form: FormData, observe?: ImportObserver) => Promise<ImportResult>,
}))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => context.signedIn ? { userId: 'test-user', householdId: 'server-household' } : null }))
// Transport tests isolate the DB-owning service. Integration tests exercise the real service.
vi.mock('@/features/inbox/import-service', () => ({
  validateImportInput: async () => { if (context.preflightError) throw context.preflightError },
  runImport: (...args: Parameters<typeof context.run>) => context.run(...args),
}))

function request(form = new FormData(), headers: Record<string, string> = { Origin: 'http://localhost:3000' }, signal?: AbortSignal) {
  if (!form.has('mode')) form.set('mode', 'card')
  return new Request('http://localhost:3000/api/import', { method: 'POST', headers, body: form, signal })
}
beforeEach(() => {
  context.signedIn = true
  context.preflightError = null
  context.run = async () => ({ message: '완료', added: 0, alreadyProcessed: 0, automatic: 0, review: 0 })
})
afterEach(() => vi.useRealTimers())

test('unauthenticated uploads return JSON 401 before reading multipart', async () => {
  context.signedIn = false
  const response = await POST(request())
  expect(response.status).toBe(401)
  expect(response.headers.get('Location')).toBeNull()
  expect(await response.json()).toMatchObject({ type: 'error', code: 'invalid_input' })
})

test.each<Record<string, string>>([{}, { Origin: 'https://foreign.example' }, { Origin: 'null' }, { Origin: 'http://localhost:3000/forged' }, { Origin: 'https://localhost:3000' }])('rejects missing or foreign origins (%#)', async (headers) => {
  expect((await POST(request(new FormData(), headers))).status).toBe(403)
})

test('compares to actual request origin, allowing an authenticated preview origin', async () => {
  const form = new FormData()
  form.set('mode', 'banksalad')
  const response = await POST(new Request('https://preview.example/api/import', { method: 'POST', headers: { Origin: 'https://preview.example' }, body: form }))
  expect(response.status).toBe(200)
  expect(await readImportStream(response, () => {})).toMatchObject({ added: 0 })
})

test.each(['invalid', '', 'CARD'])('rejects invalid mode before streaming (%s)', async (mode) => {
  const form = new FormData()
  form.set('mode', mode)
  const response = await POST(request(form))
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ code: 'invalid_input' })
})

test('rejects malformed or non-multipart bodies without reflecting them', async () => {
  for (const contentType of ['text/plain', 'multipart/form-data; boundary=absent']) {
    const response = await POST(new Request('http://localhost:3000/api/import', { method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': contentType }, body: 'private broken content' }))
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('private')
  }
})

test('caps actual request bytes even when Content-Length is missing or lies', async () => {
  for (const contentLength of [undefined, '1']) {
    let canceled = false
    const headers: Record<string, string> = { Origin: 'http://localhost:3000', 'Content-Type': 'multipart/form-data; boundary=test' }
    if (contentLength) headers['Content-Length'] = contentLength
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)) }, cancel() { canceled = true } })
    const upload = new Request('http://localhost:3000/api/import', { method: 'POST', headers, body, duplex: 'half' } as RequestInit)
    const response = await POST(upload)
    expect(response.status).toBe(413)
    expect(canceled).toBe(true)
  }
})

test('preflight errors use HTTP errors; arbitrary exceptions are sanitized', async () => {
  context.preflightError = new ImportFailure('invalid_input', '기본 카드를 선택해 주세요.')
  const invalid = await POST(request())
  expect(invalid.status).toBe(400)
  expect(await invalid.json()).toMatchObject({ code: 'invalid_input', message: '기본 카드를 선택해 주세요.' })
  context.preflightError = new Error('database credentials')
  const failed = await POST(request())
  expect(failed.status).toBe(500)
  expect(await failed.text()).not.toContain('credentials')
})

test('forwards real service stages and only returns a result after the service resolves', async () => {
  let finish!: () => void
  const deferred = new Promise<void>((resolve) => { finish = resolve })
  context.run = async (householdId, mode, form, observe) => {
    if (householdId !== 'server-household' || mode !== 'banksalad' || form.get('householdId') !== 'attacker') throw new Error('incorrect transport')
    observe?.({ type: 'stage', phase: 'matching' })
    await deferred
    observe?.({ type: 'stage', phase: 'finalizing' })
    return { message: '저장 완료', added: 2, alreadyProcessed: 1, automatic: 1, review: 1 }
  }
  const form = new FormData()
  form.set('mode', 'banksalad')
  form.set('householdId', 'attacker')
  const response = await POST(request(form))
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(response.headers.get('Content-Type')).toContain('application/x-ndjson')
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('matching')
  finish()
  const final = await reader.read()
  expect(new TextDecoder().decode(final.value)).toContain('finalizing')
  const terminal = await reader.read()
  expect(JSON.parse(new TextDecoder().decode(terminal.value))).toEqual({ type: 'result', result: { message: '저장 완료', added: 2, alreadyProcessed: 1, automatic: 1, review: 1 } })
  expect((await reader.read()).done).toBe(true)
})

test('safe streamed failures are terminal and clear heartbeat timers', async () => {
  vi.useFakeTimers()
  context.run = async () => { throw new Error('private original password') }
  const response = await POST(request())
  await expect(readImportStream(response, () => {})).rejects.toMatchObject({ code: 'processing_failed' })
  expect(vi.getTimerCount()).toBe(0)
})

test.each(['reader', 'request'])('disconnect via %s stops heartbeats and emissions while late service rejection is handled', async (kind) => {
  vi.useFakeTimers()
  let fail!: () => void
  context.run = async (_householdId, _mode, _form, observe) => {
    await new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('late private failure')) })
    observe?.({ type: 'stage', phase: 'finalizing' })
    return { message: '완료', added: 0, alreadyProcessed: 0, automatic: 0, review: 0 }
  }
  const abort = new AbortController()
  const response = await POST(request(new FormData(), undefined, abort.signal))
  const reader = response.body!.getReader()
  await vi.advanceTimersByTimeAsync(15_000)
  expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toEqual({ type: 'heartbeat' })
  if (kind === 'reader') await reader.cancel()
  else abort.abort()
  expect(vi.getTimerCount()).toBe(0)
  fail()
  await Promise.resolve()
  expect((await reader.read()).done).toBe(true)
})
