import { getBudgetData } from './queries'
import { getBudgetReviewData } from './review-queries'

export async function getBudgetPlanningData(householdId: string, requestedMonth?: string) {
  const budget = await getBudgetData(householdId, requestedMonth)
  const review = await getBudgetReviewData(householdId, budget.month)
  return { ...budget, review }
}
