'use server'

import { and, eq, max } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { accounts, categories, recurring } from '@/db/schema'
import { ledgerFiltersFromFormData, ledgerUrl } from '@/features/ledger/filters'
import { isMonthKey } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'
import { revalidateFinance } from '@/lib/revalidate'
import { parseRecurringPayload } from './recurring-input'
import { getPendingRecurringPostings, postRecurringMonth, type PendingRecurringPosting } from './posting'

export type RecurringActionState = { error?: string }

export type RecurringSelectionResult = {
  ok: boolean
  error?: string
  added?: number
  skipped?: number
  remaining?: number
  handledIds?: number[]
  pendingIds?: number[]
  notice?: string
}

export async function loadPendingRecurringMonth(month: string): Promise<{ rows?: PendingRecurringPosting[]; error?: string }> {
  const household = await requireHousehold()
  if (!household) return { error: '로그인이 필요합니다. 다시 로그인해 주세요.' }
  if (typeof month !== 'string' || !isMonthKey(month)) return { error: '조회 월을 확인해 주세요.' }
  try {
    return { rows: await getPendingRecurringPostings(household.householdId, month) }
  } catch (error) {
    return { error: error instanceof Error && error.message.includes('공휴일') ? error.message : '미반영 정기거래를 불러오지 못했습니다. 다시 시도해 주세요.' }
  }
}

export async function applySelectedRecurringMonth(month: string, selectedIds: number[]): Promise<RecurringSelectionResult> {
  const household = await requireHousehold()
  if (!household) return { ok: false, error: '로그인이 필요합니다. 다시 로그인해 주세요.' }
  if (typeof month !== 'string' || !isMonthKey(month)) return { ok: false, error: '조회 월을 확인해 주세요.' }
  if (!Array.isArray(selectedIds) || selectedIds.length === 0 || selectedIds.length > 1000
    || selectedIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return { ok: false, error: '반영할 정기거래를 선택해 주세요.' }
  }
  try {
    const result = await postRecurringMonth(household.householdId, month, [...new Set(selectedIds)])
    if ('error' in result) return { ok: false, error: result.error }
    revalidateFinance('recurring', 'transactions')
    return { ok: true, ...result }
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.message.includes('공휴일') ? error.message : '반영 결과를 확인하지 못했습니다. 다시 시도해 주세요. 이미 반영된 항목은 중복 저장되지 않습니다.' }
  }
}

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
  const outcome = await postRecurringMonth(household.householdId, monthValue).catch((error: unknown) => {
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
