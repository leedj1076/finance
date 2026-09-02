'use server'

import { and, eq, gte, lt, max, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { accounts, categories, recurring, transactions } from '@/db/schema'
import { isMonthKey, monthBounds } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

import { recurringPostingDate } from './calculations'
import { parseRecurringPayload } from './recurring-input'

export type RecurringActionState = { error?: string }

export async function saveRecurringRules(
  _previousState: RecurringActionState,
  formData: FormData,
): Promise<RecurringActionState> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }
  const parsed = parseRecurringPayload(formData.get('rules'))
  if ('error' in parsed) return { error: parsed.error }

  const [storedRows, categoryRows, accountRows] = await Promise.all([
    db.select({ id: recurring.id }).from(recurring).where(eq(recurring.householdId, household.householdId)),
    db
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(eq(categories.householdId, household.householdId)),
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.householdId, household.householdId)),
  ])
  const storedIds = new Set(storedRows.map((row) => row.id))
  const submittedIds = parsed.data.flatMap((row) => row.id === null ? [] : [row.id])
  if (submittedIds.length !== storedIds.size || submittedIds.some((id) => !storedIds.has(id))) {
    return { error: '정기거래 목록이 변경되었습니다. 새로고침 후 다시 저장해 주세요.' }
  }

  const categoryKinds = new Map(categoryRows.map((row) => [row.id, row.kind]))
  const accountIds = new Set(accountRows.map((row) => row.id))
  for (const row of parsed.data) {
    if (row.categoryId !== null && categoryKinds.get(row.categoryId) !== row.flow) {
      return { error: `${row.memo} 분류가 거래 유형과 맞지 않습니다.` }
    }
    if (row.accountId !== null && !accountIds.has(row.accountId)) {
      return { error: `${row.memo} 결제수단이 가족 가계부에 없습니다.` }
    }
  }

  const requestedMonth = formData.get('month')
  const month = typeof requestedMonth === 'string' && isMonthKey(requestedMonth)
    ? requestedMonth
    : undefined

  await db.transaction(async (transaction) => {
    const [sortRow] = await transaction
      .select({ value: max(recurring.sortOrder) })
      .from(recurring)
      .where(eq(recurring.householdId, household.householdId))
    let sortOrder = sortRow?.value ?? 0

    for (const row of parsed.data) {
      const values = {
        flow: row.flow,
        fixed: row.fixed,
        categoryId: row.categoryId,
        memo: row.memo,
        amount: row.amount,
        accountId: row.accountId,
        day: row.day,
        active: row.active,
      }
      if (row.id === null) {
        sortOrder += 1
        await transaction.insert(recurring).values({
          householdId: household.householdId,
          sortOrder,
          ...values,
        })
      } else {
        await transaction
          .update(recurring)
          .set(values)
          .where(
            and(eq(recurring.householdId, household.householdId), eq(recurring.id, row.id)),
          )
      }
    }
  })

  revalidatePath('/recurring')
  revalidatePath('/budgets')
  redirect(`/recurring${month ? `?month=${month}&saved=1` : '?saved=1'}`)
}

export async function applyRecurringMonth(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const monthValue = formData.get('month')
  if (typeof monthValue !== 'string' || !isMonthKey(monthValue)) {
    redirect('/recurring?error=month')
  }
  const { start, end } = monthBounds(monthValue)

  const result = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`recurring:${household.householdId}:${monthValue}`}))`,
    )
    const [rules, generatedRows] = await Promise.all([
      transaction
        .select({
          id: recurring.id,
          flow: recurring.flow,
          fixed: recurring.fixed,
          categoryId: categories.id,
          memo: recurring.memo,
          amount: recurring.amount,
          accountId: accounts.id,
          day: recurring.day,
        })
        .from(recurring)
        .leftJoin(
          categories,
          and(eq(categories.id, recurring.categoryId), eq(categories.householdId, household.householdId)),
        )
        .leftJoin(
          accounts,
          and(eq(accounts.id, recurring.accountId), eq(accounts.householdId, household.householdId)),
        )
        .where(and(eq(recurring.householdId, household.householdId), eq(recurring.active, true)))
        .orderBy(recurring.sortOrder, recurring.id),
      transaction
        .select({ recurringId: transactions.recurringId })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, household.householdId),
            gte(transactions.date, start),
            lt(transactions.date, end),
            sql`${transactions.recurringId} is not null`,
          ),
        ),
    ])
    const generated = new Set(generatedRows.flatMap((row) => row.recurringId === null ? [] : [row.recurringId]))
    const pending = rules.filter((rule) => !generated.has(rule.id))
    if (pending.length > 0) {
      await transaction.insert(transactions).values(pending.map((rule) => ({
        householdId: household.householdId,
        date: recurringPostingDate(monthValue, rule.day),
        flow: rule.flow,
        fixed: rule.fixed,
        categoryId: rule.categoryId,
        memo: rule.memo,
        amount: rule.amount,
        accountId: rule.accountId,
        source: 'recurring',
        recurringId: rule.id,
      })))
    }
    return { added: pending.length, skipped: rules.length - pending.length }
  })

  revalidatePath('/recurring')
  revalidatePath('/ledger')
  revalidatePath('/dashboard')
  revalidatePath('/analysis')
  redirect(`/ledger?month=${monthValue}&recurringAdded=${result.added}&recurringSkipped=${result.skipped}`)
}
