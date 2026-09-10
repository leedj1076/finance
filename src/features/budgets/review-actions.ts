'use server'

import { saveBudgetPlan, type BudgetActionState } from './actions'

export type BudgetReviewActionState = BudgetActionState

export async function saveBudgetReview(
  _previousState: BudgetReviewActionState,
  formData: FormData,
): Promise<BudgetReviewActionState> {
  return saveBudgetPlan(_previousState, formData)
}
