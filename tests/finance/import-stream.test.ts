import { expect, test } from 'vitest'

import { readImportStream } from '@/features/inbox/import-stream'

const result = { message: '인박스에 1건 추가', added: 1, alreadyProcessed: 2, automatic: 0, review: 1 }
const encoder = new TextEncoder()
function response(text: string, chunkSize = 1) {
  const bytes = encoder.encode(text)
  return new Response(new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize))
    controller.close()
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
}

test('decodes UTF-8 and JSON split across arbitrary byte boundaries', async () => {
  const events: unknown[] = []
  const stream = response(`${JSON.stringify({ type: 'stage', phase: 'saving', completed: 0, total: 1 })}\n{"type":"heartbeat"}\n${JSON.stringify({ type: 'result', result })}\n`)
  expect(await readImportStream(stream, (event) => events.push(event))).toEqual(result)
  expect(events).toEqual([{ type: 'stage', phase: 'saving', completed: 0, total: 1 }, { type: 'heartbeat' }, { type: 'result', result }])
})

test('EOF without a complete result is unknown completion, never success', async () => {
  for (const text of ['', '{"type":"heartbeat"}\n', '{"type":"result"']) {
    await expect(readImportStream(response(text), () => {})).rejects.toMatchObject({ code: 'connection_lost' })
  }
})

test('accepts a terminal result without waiting for server EOF and cancels reading', async () => {
  let canceled = false
  const stream = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'result', result })}\n`))
  }, cancel() { canceled = true } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
  expect(await readImportStream(stream, () => {})).toEqual(result)
  expect(canceled).toBe(true)
})

test('typed server errors are terminal and cannot be followed by success', async () => {
  const events: unknown[] = []
  const error = { type: 'error', code: 'password_incorrect', message: '비밀번호가 맞지 않습니다.' }
  await expect(readImportStream(response(`${JSON.stringify(error)}\n${JSON.stringify({ type: 'result', result })}\n`, 2048), (event) => events.push(event))).rejects.toMatchObject({ code: 'password_incorrect', message: error.message })
  expect(events).toEqual([error])
})

test.each([
  '{broken}\n',
  '{"type":"stage","phase":"invented"}\n',
  '{"type":"stage","phase":["reading"]}\n',
  '{"type":"stage","phase":"saving","completed":-1,"total":2}\n',
  '{"type":"stage","phase":"saving","completed":3,"total":2}\n',
  '{"type":"stage","phase":"saving","completed":1}\n',
  '{"type":"heartbeat","password":"secret"}\n',
  '{"type":"error","code":"raw_exception","message":"secret"}\n',
  '{"type":"error","code":["invalid_input"],"message":"secret"}\n',
  '{"type":"result","result":{"message":"done","added":-1}}\n',
  `${'x'.repeat(17_000)}\n`,
])('rejects malformed or unbounded frames without forwarding them (%#)', async (text) => {
  const events: unknown[] = []
  await expect(readImportStream(response(text, 1024), (event) => events.push(event))).rejects.toMatchObject({ code: 'connection_lost' })
  expect(events).toEqual([])
})

test('rejects invalid UTF-8 rather than replacing source bytes', async () => {
  const stream = new Response(new Uint8Array([0xff, 10]), { headers: { 'Content-Type': 'application/x-ndjson' } })
  await expect(readImportStream(stream, () => {})).rejects.toMatchObject({ code: 'connection_lost' })
})

test('handles HTTP errors before streaming without exposing HTML or arbitrary exception text', async () => {
  await expect(readImportStream(new Response('<html>secret</html>', { status: 500 }), () => {})).rejects.toMatchObject({ code: 'processing_failed' })
  const error = { type: 'error', code: 'invalid_input', message: '파일을 선택해 주세요.' }
  await expect(readImportStream(Response.json(error, { status: 400 }), () => {})).rejects.toMatchObject({ code: 'invalid_input', message: error.message })
  await expect(readImportStream(new Response('<html>login</html>'), () => {})).rejects.toMatchObject({ code: 'connection_lost' })
})

test('a failed network read reports unknown completion and never retries', async () => {
  let pulls = 0
  const stream = new Response(new ReadableStream({ pull(controller) { pulls++; controller.error(new Error('private failure')) } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
  await expect(readImportStream(stream, () => {})).rejects.toMatchObject({ code: 'connection_lost' })
  expect(pulls).toBe(1)
})
