'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { budgets } from '@/db/schema'
import { isMonthKey } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

import { parseBudgetAmount } from './budget-input'
import { getExpenseMajorNames } from './queries'

export type BudgetReviewActionState = { error?: string }

export async function saveBudgetReview(
  _previousState: BudgetReviewActionState,
  formData: FormData,
): Promise<BudgetReviewActionState> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }
  const targetMonth = formData.get('targetMonth')
  if (typeof targetMonth !== 'string' || !isMonthKey(targetMonth)) {
    return { error: '예산을 만들 월이 올바르지 않습니다.' }
  }
  const majors = await getExpenseMajorNames(household.householdId)
  const amounts = new Map<string, number>()
  for (const major of majors) {
    const amount = parseBudgetAmount(formData.get(`budget:${major}`))
    if (amount === null) return { error: `${major} 예산을 0 이상의 정수로 입력해 주세요.` }
    amounts.set(major, amount)
  }

  await db.transaction(async (transaction) => {
    for (const [major, amount] of amounts) {
      await transaction
        .insert(budgets)
        .values({ householdId: household.householdId, major, month: targetMonth, amount })
        .onConflictDoUpdate({
          target: [budgets.householdId, budgets.major, budgets.month],
          set: { amount },
        })
    }
  })
  revalidatePath('/budgets')
  revalidatePath('/budgets/review')
  revalidatePath('/ledger')
  redirect(`/budgets?month=${targetMonth}&reviewSaved=1`)
}
