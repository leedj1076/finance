import { db } from '@/db/client'
import { readBudgetData } from './queries'
import { readBudgetReviewData } from './review-queries'
import { readBudgetBaselines } from './save-service'

export async function getBudgetPlanningData(householdId: string, requestedMonth?: string) {
  return db.transaction(async transaction => {
    const now = new Date()
    const budget = await readBudgetData(transaction, householdId, requestedMonth, now)
    const [review, baseline] = await Promise.all([
      readBudgetReviewData(transaction, householdId, budget.month, now),
      readBudgetBaselines(transaction, householdId, budget.month),
    ])
    return { ...budget, review, baselines: baseline.rows, targetVersion: baseline.targetVersion }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}
