import { type NextRequest, NextResponse } from 'next/server'

import {
  getCellTransactions,
  parseCellTransactionParams,
  StaleClosedMonthError,
} from '@/features/analytics/category-detail'
import { requireHousehold } from '@/lib/household'

export async function GET(request: NextRequest) {
  const household = await requireHousehold()
  if (!household) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const params = parseCellTransactionParams(request.nextUrl.searchParams)
  if (!params) {
    return NextResponse.json({ error: '조회 조건이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const result = await getCellTransactions(household.householdId, params)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof StaleClosedMonthError) return NextResponse.json({ error: error.message, refresh: true }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
    throw error
  }
}
