import { ImportFailure, type ImportEvent, type ImportResult } from './import-progress'

const MAX_FRAME_BYTES = 16 * 1024
const phases = new Set(['validating', 'reading', 'matching', 'classifying', 'saving', 'finalizing'])
const codes = new Set(['password_required', 'password_incorrect', 'invalid_input', 'processing_failed', 'connection_lost'])
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const message = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 2048
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key))

function parseEvent(text: string): ImportEvent {
  const value: unknown = JSON.parse(text)
  if (record(value)) {
    if (value.type === 'heartbeat' && keys(value, ['type'])) return { type: 'heartbeat' }
    if (value.type === 'stage' && keys(value, ['type', 'phase', 'completed', 'total']) && typeof value.phase === 'string' && phases.has(value.phase)) {
      const hasCounts = value.completed !== undefined || value.total !== undefined
      if (!hasCounts || (count(value.completed) && count(value.total) && Number(value.completed) <= Number(value.total))) return value as ImportEvent
    }
    if (value.type === 'error' && keys(value, ['type', 'code', 'message']) && typeof value.code === 'string' && codes.has(value.code) && message(value.message)) return value as ImportEvent
    if (value.type === 'result' && keys(value, ['type', 'result']) && record(value.result)) {
      const result = value.result
      if (keys(result, ['message', 'added', 'alreadyProcessed', 'automatic', 'review']) && message(result.message) &&
        count(result.added) && count(result.alreadyProcessed) && count(result.automatic) && count(result.review)) return value as ImportEvent
    }
  }
  throw new ImportFailure('connection_lost')
}

export async function readImportStream(response: Response, onEvent: (event: ImportEvent) => void): Promise<ImportResult> {
  const reader = response.body?.getReader()
  if (!reader) throw new ImportFailure(response.ok ? 'connection_lost' : 'processing_failed')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = ''
  let frameBytes = 0
  try {
    if (response.ok && response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/x-ndjson') throw new ImportFailure('connection_lost')
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        pending += decoder.decode()
        if (!response.ok && pending) {
          const event = parseEvent(pending)
          if (event.type === 'error') throw new ImportFailure(event.code, event.message)
        }
        throw new ImportFailure(response.ok ? 'connection_lost' : 'processing_failed')
      }
      // Count bytes before decoding so a fragmented or unterminated frame stays bounded.
      let offset = 0
      for (let index = 0; index < value.length; index++) {
        frameBytes++
        if (frameBytes > MAX_FRAME_BYTES) throw new ImportFailure(response.ok ? 'connection_lost' : 'processing_failed')
        if (value[index] !== 10 || !response.ok) continue
        pending += decoder.decode(value.subarray(offset, index + 1), { stream: true })
        const event = parseEvent(pending.trimEnd())
        onEvent(event)
        if (event.type === 'error') throw new ImportFailure(event.code, event.message)
        if (event.type === 'result') return event.result
        pending = ''
        frameBytes = 0
        offset = index + 1
      }
      pending += decoder.decode(value.subarray(offset), { stream: true })
    }
  } catch (error) {
    if (error instanceof ImportFailure && (response.ok || error.code !== 'connection_lost')) throw error
    throw new ImportFailure(response.ok ? 'connection_lost' : 'processing_failed')
  } finally {
    // Do not wait on a remote producer to acknowledge cancellation after a terminal event.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
