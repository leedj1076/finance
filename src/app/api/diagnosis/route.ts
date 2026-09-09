import { DiagnosisRequestError, getDiagnosisPageData, requestDiagnosis } from '@/features/diagnosis/queries'
import { currentMonthInKorea, isMonthKey } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' }
const response = (data: unknown, status = 200) => Response.json(data, { status, headers })

function validMonth(month: unknown): month is string {
  return typeof month === 'string' && isMonthKey(month) && month >= '2000-01' && month <= currentMonthInKorea()
}

function failure(error: unknown) {
  return error instanceof DiagnosisRequestError
    ? response({ error: error.message }, error.status)
    : response({ error: '진단 정보를 처리하지 못했어요. 잠시 후 다시 시도해주세요.' }, 500)
}

async function readBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '') || !request.body) throw new DiagnosisRequestError('진단할 월을 확인해주세요.')
  const reader = request.body.getReader()
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 1024) throw new DiagnosisRequestError('요청 내용이 너무 큽니다.', 413)
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new DiagnosisRequestError('진단할 월을 확인해주세요.') }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const household = await requireHousehold()
    if (!household) return response({ error: '가족 가계부에 연결된 계정으로 로그인해주세요.' }, 401)
    const params = new URL(request.url).searchParams
    const month = params.get('month')
    if (!validMonth(month) || params.getAll('month').length !== 1) return response({ error: '조회할 월을 확인해주세요.' }, 400)
    return response(await getDiagnosisPageData(household.householdId, month))
  } catch (error) { return failure(error) }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const household = await requireHousehold()
    if (!household) return response({ error: '가족 가계부에 연결된 계정으로 로그인해주세요.' }, 401)
    if (request.headers.get('Origin') !== new URL(request.url).origin) return response({ error: '가계부 화면에서 다시 요청해주세요.' }, 403)
    const body = await readBody(request)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('month' in body) || !validMonth(body.month)) return response({ error: '진단할 월을 확인해주세요.' }, 400)
    return response(await requestDiagnosis(household.householdId, household.userId, body.month))
  } catch (error) { return failure(error) }
}
