import { BudgetInputError, parseBudgetRequest } from '@/features/budget-recommendations/input'
import { BudgetRecommendationError, getBudgetRecommendationData, requestBudgetRecommendation } from '@/features/budget-recommendations/service'
import { isMonthKey } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' }
const response = (data: unknown, status = 200) => Response.json(data, { status, headers })
function failure(error: unknown) {
  if (error instanceof BudgetInputError) return response({ error: 'invalid_input' }, 400)
  if (error instanceof BudgetRecommendationError) return response({ error: error.code }, error.status)
  return response({ error: 'request_failed' }, 500)
}
async function readBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '') || !request.body) throw new BudgetInputError()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 128 * 1024) throw new BudgetRecommendationError('body_too_large', 413)
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new BudgetInputError() }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export async function GET(request: Request): Promise<Response> {
  try {
    const household = await requireHousehold()
    if (!household) return response({ error: 'unauthorized' }, 401)
    const params = new URL(request.url).searchParams
    const month = params.get('month')
    if (!month || !isMonthKey(month) || params.getAll('month').length !== 1) return response({ error: 'invalid_input' }, 400)
    return response(await getBudgetRecommendationData(household.householdId, month))
  } catch (error) { return failure(error) }
}
export async function POST(request: Request): Promise<Response> {
  try {
    const household = await requireHousehold()
    if (!household) return response({ error: 'unauthorized' }, 401)
    if (request.headers.get('Origin') !== new URL(request.url).origin) return response({ error: 'forbidden' }, 403)
    const input = parseBudgetRequest(await readBody(request))
    return response(await requestBudgetRecommendation(household.householdId, household.userId, input))
  } catch (error) { return failure(error) }
}
