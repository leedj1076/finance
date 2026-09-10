'use server'

import { requireHousehold } from '@/lib/household'
import { revalidateFinance } from '@/lib/revalidate'
import { parseBudgetSaveRequest, type BudgetSaveResult } from './save-contract'
import { saveBudgetChanges } from './save-service'

export type BudgetActionState = {
  error?: string
  code?: string
  saved?: BudgetSaveResult
}

const messages: Record<string, string> = {
  invalid_input: '예산과 목표 저축률을 올바른 정수로 입력해 주세요.',
  invalid_amount: '금액이 저장 가능한 범위를 벗어났습니다.',
  budget_conflict: '다른 창에서 예산이나 저축 목표가 변경되었습니다. 최신 예산을 확인한 뒤 다시 저장해 주세요.',
  overage_confirmation_required: '미분류 지출과 정기 지출을 포함한 전체 예산이 상한을 넘습니다. 초과 저장에 동의해 주세요.',
  save_target_first: '저축 목표를 먼저 수동으로 저장한 뒤 AI 예산을 다시 추천받아 주세요.',
  source_changed: '추천 이후 근거가 변경되었습니다. 다시 추천받거나 수동 초안으로 전환해 주세요.',
  budgets_changed: '추천 이후 예산이 변경되었습니다. 다시 추천받거나 수동 초안으로 전환해 주세요.',
  invalid_result: '유효한 AI 추천을 확인할 수 없습니다. 다시 추천받거나 수동 초안으로 전환해 주세요.',
}

export async function saveBudgetPlan(
  _previousState: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }

  const payload = formData.get('payload')
  if (typeof payload !== 'string') {
    return { code: 'refresh_required', error: '예산 화면을 새로 열어 변경사항을 확인해 주세요.' }
  }
  let request
  try {
    request = parseBudgetSaveRequest(JSON.parse(payload))
  } catch {
    return { code: 'invalid_input', error: messages.invalid_input }
  }
  let saved: BudgetSaveResult
  try {
    saved = await saveBudgetChanges(household.householdId, request)
  } catch (error) {
    const code = error instanceof Error && error.message in messages ? error.message : 'save_failed'
    return { code, error: messages[code] ?? '예산을 저장하지 못했습니다. 입력한 초안을 유지한 채 다시 시도해 주세요.' }
  }
  revalidateFinance('budgets')
  return { saved }
}
