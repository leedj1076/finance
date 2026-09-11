import { db } from '@/db/client'
import { readSavedBudgetRecommendations } from '@/features/budget-recommendations/service'
import { readBudgetData } from './queries'
import { readBudgetReviewData } from './review-queries'
import { readBudgetBaselines } from './save-service'
import { readBudgetPlanRows } from './plan-sources'

export async function getBudgetPlanningData(householdId: string, requestedMonth?: string) {
  return db.transaction(async transaction => {
    const now = new Date()
    const budget = await readBudgetData(transaction, householdId, requestedMonth, now)
    const [review, baseline, savedRecommendations] = await Promise.all([
      readBudgetReviewData(transaction, householdId, budget.month, now),
      readBudgetBaselines(transaction, householdId, budget.month),
      readSavedBudgetRecommendations(transaction, householdId, budget.month),
    ])
    const planRows = await readBudgetPlanRows(transaction, householdId, {
      month: budget.month,
      budgetRows: budget.rows,
      baselineRows: baseline.rows,
      reviewRows: review.rows,
    }, now)
    return {
      ...budget,
      review,
      baselines: baseline.rows,
      targetVersion: baseline.targetVersion,
      savedRecommendations,
      planRows,
      basis: {
        averageIncome: budget.averageIncome,
        savingsTarget: budget.savingsTarget,
        spendCeiling: budget.spendCeiling,
        incomeStart: budget.incomeBasis.start,
        incomeEnd: budget.incomeBasis.end,
        incomeMonthCount: budget.incomeBasis.monthCount,
      },
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}
