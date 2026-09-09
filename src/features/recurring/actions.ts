'use server'

import { and, eq, max, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { accounts, categories, recurring, transactions } from '@/db/schema'
import { ledgerFiltersFromFormData, ledgerUrl } from '@/features/ledger/filters'
import { isMonthKey } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'
import { revalidateFinance } from '@/lib/revalidate'
import { captureClosedMonths, reopenedMonthNotice } from '@/features/month-close/mutation-notice'

import { recurringImportUid, recurringIsDue, recurringMemo, recurringPostingDate } from './calculations'
import { previousKoreanBusinessDay } from './business-days'
import { parseRecurringPayload } from './recurring-input'
import { recurringPostingInMonth } from './posting-identity'

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
    db.select({ id: recurring.id, startMonth: recurring.startMonth, endMonth: recurring.endMonth,
      startOccurrence: recurring.startOccurrence, adjustToBusinessDay: recurring.adjustToBusinessDay })
      .from(recurring).where(eq(recurring.householdId, household.householdId)),
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
  // Validate the effective schedule too: older clients omit its fields.
  const storedSchedules = new Map(storedRows.map((row) => [row.id, row]))
  const effective = parseRecurringPayload(JSON.stringify(parsed.data.map((row) => ({
    ...(row.id === null ? {} : storedSchedules.get(row.id)), ...row,
    flowToken: row.flow === 'expense' ? row.fixed ? 'exp_fix' : 'exp_var' : row.flow,
  }))))
  if ('error' in effective) return { error: effective.error }
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
        startMonth: row.startMonth,
        endMonth: row.endMonth,
        startOccurrence: row.startOccurrence,
        adjustToBusinessDay: row.adjustToBusinessDay,
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

  revalidateFinance('recurring')
  redirect(`/recurring${month ? `?month=${month}&saved=1` : '?saved=1'}`)
}

export async function applyRecurringMonth(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const monthValue = formData.get('month')
  if (typeof monthValue !== 'string' || !isMonthKey(monthValue)) {
    redirect('/recurring?error=month')
  }
  const outcome = await db.transaction(async (transaction) => {
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
          active: recurring.active,
          startMonth: recurring.startMonth,
          endMonth: recurring.endMonth,
          startOccurrence: recurring.startOccurrence,
          adjustToBusinessDay: recurring.adjustToBusinessDay,
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
            recurringPostingInMonth(monthValue),
          ),
        ),
    ])
    const generated = new Set(generatedRows.flatMap((row) => row.recurringId === null ? [] : [row.recurringId]))
    const dueRules = rules.filter((rule) => recurringIsDue(rule, monthValue))
    const pending = dueRules.filter((rule) => !generated.has(rule.id))
    // Resolve every date before writing anything; missing calendar data is not a partial posting.
    const values = await Promise.all(pending.map(async (rule) => {
      const scheduledDate = recurringPostingDate(monthValue, rule.day)
      return {
        householdId: household.householdId,
        date: rule.adjustToBusinessDay ? await previousKoreanBusinessDay(scheduledDate) : scheduledDate,
        flow: rule.flow,
        fixed: rule.fixed,
        categoryId: rule.categoryId,
        memo: recurringMemo(rule, monthValue),
        amount: rule.amount,
        accountId: rule.accountId,
        source: 'recurring',
        recurringId: rule.id,
        importUid: recurringImportUid(rule.id, monthValue),
      }
    }))
    // The unique index also guards concurrent writes to the same identity.
    const closedBefore = await captureClosedMonths(household.householdId, values.map(row => row.date), transaction)
    const created = pending.length === 0 ? [] : await transaction
      .insert(transactions)
      .values(values)
      .onConflictDoNothing({
        target: [transactions.householdId, transactions.importUid],
      })
      .returning({ id: transactions.id })
    return { added: created.length, skipped: dueRules.length - created.length, notice: await reopenedMonthNotice(household.householdId, closedBefore, transaction) }
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes('공휴일')) return { error: error.message }
    throw error
  })

  revalidateFinance('recurring', 'transactions')
  const requestedTab = formData.get('returnTab')
  const tab = typeof requestedTab === 'string' && ['summary', 'categories', 'merchants', 'list'].includes(requestedTab)
    ? requestedTab : undefined
  redirect(ledgerUrl(monthValue, ledgerFiltersFromFormData(formData), {
    tab, ...('error' in outcome ? { recurringError: outcome.error } : {
      recurringAdded: outcome.added, recurringSkipped: outcome.skipped,
      ...(outcome.notice ? { notice: `정기거래를 반영했습니다.${outcome.notice}` } : {}),
    }),
  }))
}
