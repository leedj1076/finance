import { ImportFailure, importErrorEvent, type ImportEvent } from '@/features/inbox/import-progress'
import { runImport, validateImportInput } from '@/features/inbox/import-service'
import { requireHousehold } from '@/lib/household'

export const runtime = 'nodejs'
export const maxDuration = 300
const MAX_BODY_BYTES = 4 * 1024 * 1024 + 64 * 1024 // Two 2MiB files plus bounded multipart fields/headers.
const HEARTBEAT_MS = 15_000

function errorResponse(error: unknown, status: number) {
  return Response.json(importErrorEvent(error), { status, headers: { 'Cache-Control': 'no-store' } })
}

class BodyTooLarge extends ImportFailure {
  constructor() { super('invalid_input', '업로드 파일의 전체 크기가 너무 큽니다. 파일당 2MB 이하로 선택해 주세요.') }
}

async function boundedFormData(request: Request) {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) throw new ImportFailure('invalid_input')
  const contentLength = request.headers.get('Content-Length')
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) throw new BodyTooLarge()
  const reader = request.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) throw new BodyTooLarge()
      chunks.push(new Uint8Array(value))
    }
    // The multipart parser sees at most MAX_BODY_BYTES, including non-file fields.
    return await new Response(new Blob(chunks), { headers: { 'Content-Type': contentType } }).formData()
  } catch (error) {
    if (error instanceof ImportFailure) throw error
    throw new ImportFailure('invalid_input', '업로드 요청을 읽지 못했습니다. 파일을 다시 선택해 주세요.')
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function POST(request: Request): Promise<Response> {
  let householdId: string
  let data: FormData
  let mode: 'card' | 'banksalad'
  try {
    const household = await requireHousehold()
    if (!household) return errorResponse(new ImportFailure('invalid_input', '가족 가계부에 연결된 계정으로 다시 로그인해 주세요.'), 401)
    householdId = household.householdId
    if (request.headers.get('Origin') !== new URL(request.url).origin) {
      return errorResponse(new ImportFailure('invalid_input', '같은 사이트에서 파일을 다시 업로드해 주세요.'), 403)
    }
    data = await boundedFormData(request)
    const submittedMode = data.get('mode')
    if ((submittedMode !== 'card' && submittedMode !== 'banksalad') || data.getAll('mode').length !== 1) throw new ImportFailure('invalid_input')
    mode = submittedMode
    await validateImportInput(householdId, mode, data)
  } catch (error) {
    return errorResponse(error, error instanceof BodyTooLarge ? 413 : error instanceof ImportFailure ? 400 : 500)
  }

  let stop = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let active = true
      const cleanup = () => {
        active = false
        clearInterval(heartbeat)
        request.signal.removeEventListener('abort', disconnect)
      }
      const disconnect = () => {
        if (!active) return
        cleanup()
        controller.close()
      }
      stop = cleanup
      const encoder = new TextEncoder()
      const emit = (event: ImportEvent) => {
        if (!active) return
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)) } catch { cleanup() }
      }
      const heartbeat = setInterval(() => {
        // Heartbeats carry connectivity only; do not grow a queue for a stalled reader.
        if ((controller.desiredSize ?? 0) > 0) emit({ type: 'heartbeat' })
      }, HEARTBEAT_MS)
      request.signal.addEventListener('abort', disconnect, { once: true })
      if (request.signal.aborted) { disconnect(); return }
      void (async () => {
        try {
          const result = await runImport(householdId, mode, data, emit)
          emit({ type: 'result', result })
        } catch (error) {
          emit(importErrorEvent(error))
        } finally {
          if (active) { cleanup(); controller.close() }
        }
      })().catch(() => { cleanup() })
      // Disconnect stops reporting; it cannot promise rollback of already started DB work.
    },
    cancel() { stop() },
  })
  return new Response(stream, { headers: {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, no-transform',
    'X-Content-Type-Options': 'nosniff',
    'X-Accel-Buffering': 'no',
  } })
}
