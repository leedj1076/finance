import { getInboxHistoryItems } from '@/features/inbox/history-queries'
import { isInboxHistoryRequest } from '@/features/inbox/history-request'
import { requireHousehold } from '@/lib/household'

export const runtime = 'nodejs'

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET(request: Request): Promise<Response> {
  try {
    const household = await requireHousehold()
    if (!household) return json({ error: '가족 가계부에 연결된 계정이 아닙니다.' }, 401)
    const url = new URL(request.url)
    const keys = ['source', 'processedOn', 'status', 'page']
    const invalid = () => json({ error: '처리 기록 조회 조건이 올바르지 않습니다.' }, 400)
    if (url.search.length > 2048 || [...url.searchParams.keys()].some((key) => !keys.includes(key))
      || keys.some((key) => url.searchParams.getAll(key).length !== 1)) return invalid()
    const page = url.searchParams.get('page')!
    if (!/^\d+$/.test(page)) return invalid()
    const input = {
      source: url.searchParams.get('source'), processedOn: url.searchParams.get('processedOn'),
      status: url.searchParams.get('status'), page: Number(page),
    }
    if (!isInboxHistoryRequest(input)) return invalid()
    return json({ data: await getInboxHistoryItems(household.householdId, input) })
  } catch {
    return json({ error: '항목을 불러오지 못했습니다. 다시 시도해 주세요.' }, 500)
  }
}
