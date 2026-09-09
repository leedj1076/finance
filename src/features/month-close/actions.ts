'use server'

import { requireHousehold } from '@/lib/household'
import { revalidateFinance } from '@/lib/revalidate'
import { getMonthCloseSummary } from './queries'
import { closeMonth, reopenMonth, type MonthCloseResult } from './service'
import { validLedgerMonth, type CloseMonthInput, type MonthCloseSummary } from './state'

export async function loadMonthCloseSummary(month: string): Promise<{ summary?: MonthCloseSummary; error?: string }> {
  const household = await requireHousehold()
  if (!household) return { error: '로그인이 필요합니다.' }
  if (!validLedgerMonth(month)) return { error: '올바른 월을 선택해 주세요.' }
  try { return { summary: await getMonthCloseSummary(household.householdId, month) } }
  catch { return { error: '월 요약을 불러오지 못했습니다. 다시 시도해 주세요.' } }
}

export async function closeLedgerMonth(input: CloseMonthInput): Promise<MonthCloseResult> {
  const household = await requireHousehold()
  if (!household) return { ok: false, error: '로그인이 필요합니다.' }
  try {
    const result = await closeMonth(household.householdId, household.userId, input)
    if (result.ok) revalidateFinance('monthClose')
    return result
  } catch { return { ok: false, error: '마감 결과를 확인하지 못했습니다. 최신 요약을 확인한 뒤 다시 시도해 주세요.' } }
}

export async function reopenLedgerMonth(month: string): Promise<MonthCloseResult> {
  const household = await requireHousehold()
  if (!household) return { ok: false, error: '로그인이 필요합니다.' }
  try {
    const result = await reopenMonth(household.householdId, month)
    if (result.ok) revalidateFinance('monthClose')
    return result
  } catch { return { ok: false, error: '마감 해제를 확인하지 못했습니다. 다시 시도해 주세요.' } }
}
