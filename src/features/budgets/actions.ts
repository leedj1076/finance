'use server'

import { sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { budgets, settings } from '@/db/schema'
import { isMonthKey } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

import { parseBudgetAmount, parseSavingsTarget } from './budget-input'
import { getExpenseMajorNames } from './queries'

export type BudgetActionState = {
  error?: string
}

export async function saveBudgetPlan(
  _previousState: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }

  const monthValue = formData.get('month')
  if (typeof monthValue !== 'string' || !isMonthKey(monthValue)) {
    return { error: '예산 월이 올바르지 않습니다.' }
  }

  const savingsTarget = parseSavingsTarget(formData.get('savingsTarget'))
  if (savingsTarget === null) return { error: '목표 저축률은 0~80%로 입력해 주세요.' }

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
        .values({
          householdId: household.householdId,
          major,
          month: monthValue,
          amount,
        })
        .onConflictDoUpdate({
          target: [budgets.householdId, budgets.major, budgets.month],
          set: { amount },
        })
    }

    await transaction
      .insert(settings)
      .values({
        householdId: household.householdId,
        key: 'savings_target',
        value: String(savingsTarget),
      })
      .onConflictDoUpdate({
        target: [settings.householdId, settings.key],
        set: { value: sql`excluded.value` },
      })
  })

  revalidatePath('/budgets')
  revalidatePath('/ledger')
  redirect(`/budgets?month=${monthValue}`)
}
