import { parseAiSettingsSave, parseAiSettingsValues } from '@/features/ai-settings/input'
import { getAiJobPrompt, previewAiPrompt } from '@/features/ai-settings/preview'
import { getAiSettings, getAiSettingsPageData, saveAiSettings } from '@/features/ai-settings/service'
import type { AiKind } from '@/features/ai-settings/types'
import { isMonthKey } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESPONSE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: RESPONSE_HEADERS })

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('invalid_input')
  const input = value as Record<string, unknown>
  const actual = Object.keys(input).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error('invalid_input')
  return input
}

function kind(value: unknown): AiKind {
  if (value !== 'ledger' && value !== 'budget') throw new Error('invalid_input')
  return value
}

async function readBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '') || !request.body) throw new Error('invalid_input')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 128 * 1024) throw new Error('body_too_large')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Error('invalid_input') }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function failure(error: unknown, householdId?: string) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'ai_settings_conflict' && householdId) {
    return response({ error: code, current: await getAiSettings(householdId) }, 409)
  }
  if (code === 'not_found') return response({ error: code }, 404)
  if (code === 'body_too_large') return response({ error: code }, 413)
  if (['invalid_input', 'invalid_ai_settings', 'invalid_ai_prompt'].includes(code)) return response({ error: 'invalid_input' }, 400)
  if (['preview_no_data', 'preview_missing_income', 'preview_month_unavailable', 'prompt_unavailable'].includes(code)) return response({ error: code }, 409)
  return response({ error: 'request_failed' }, 500)
}

export async function GET(): Promise<Response> {
  try {
    const household = await requireHousehold()
    if (!household) return response({ error: 'unauthorized' }, 401)
    return response(await getAiSettingsPageData(household.householdId))
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  let householdId: string | undefined
  try {
    const household = await requireHousehold()
    if (!household) return response({ error: 'unauthorized' }, 401)
    householdId = household.householdId
    if (request.headers.get('Origin') !== new URL(request.url).origin) return response({ error: 'forbidden' }, 403)
    const raw = await readBody(request)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_input')
    const action = (raw as Record<string, unknown>).action
    if (action === 'save') {
      const input = exact(raw, ['action', 'settings'])
      return response(await saveAiSettings(household.householdId, household.userId, parseAiSettingsSave(input.settings)))
    }
    if (action === 'preview') {
      const input = exact(raw, ['action', 'kind', 'month', 'values'])
      const selectedKind = kind(input.kind)
      if (typeof input.month !== 'string' || !isMonthKey(input.month)) throw new Error('invalid_input')
      const values = parseAiSettingsValues(input.values)
      return response(await previewAiPrompt(household.householdId, { kind: selectedKind, month: input.month, values }))
    }
    if (action === 'job-prompt') {
      const input = exact(raw, ['action', 'kind', 'jobId'])
      const selectedKind = kind(input.kind)
      if (typeof input.jobId !== 'string' || !UUID.test(input.jobId)) throw new Error('invalid_input')
      return response(await getAiJobPrompt(household.householdId, selectedKind, input.jobId))
    }
    throw new Error('invalid_input')
  } catch (error) {
    return failure(error, householdId)
  }
}
