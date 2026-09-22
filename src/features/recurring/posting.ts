import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { accounts, categories, recurring, transactions } from '@/db/schema'
import { captureClosedMonths, reopenedMonthNotice } from '@/features/month-close/mutation-notice'
import { recurringImportUid, recurringIsDue, recurringMemo, recurringPostingDate } from './calculations'
import { previousKoreanBusinessDay } from './business-days'
import { recurringPostingInMonth } from './posting-identity'

export type PendingRecurringPosting = {
  id: number
  date: string
  memo: string
  flow: string
  amount: number
  category: string
  account: string
}

async function readPostingState(reader: Pick<typeof db, 'select'>, householdId: string, month: string) {
  const [rules, generatedRows] = await Promise.all([
    reader.select({
      id: recurring.id, flow: recurring.flow, fixed: recurring.fixed,
      categoryId: categories.id, major: categories.major, sub: categories.sub,
      memo: recurring.memo, amount: recurring.amount, accountId: accounts.id, accountName: accounts.name,
      day: recurring.day, active: recurring.active, startMonth: recurring.startMonth,
      endMonth: recurring.endMonth, startOccurrence: recurring.startOccurrence,
      adjustToBusinessDay: recurring.adjustToBusinessDay,
    }).from(recurring)
      .leftJoin(categories, and(eq(categories.id, recurring.categoryId), eq(categories.householdId, householdId)))
      .leftJoin(accounts, and(eq(accounts.id, recurring.accountId), eq(accounts.householdId, householdId)))
      .where(and(eq(recurring.householdId, householdId), eq(recurring.active, true)))
      .orderBy(recurring.sortOrder, recurring.id),
    reader.select({ recurringId: transactions.recurringId }).from(transactions)
      .where(and(eq(transactions.householdId, householdId), recurringPostingInMonth(month))),
  ])
  const generated = new Set(generatedRows.flatMap(row => row.recurringId === null ? [] : [row.recurringId]))
  const dueRules = rules.filter(rule => recurringIsDue(rule, month))
  return { dueRules, pending: dueRules.filter(rule => !generated.has(rule.id)) }
}

async function postingDate(rule: { day: number; adjustToBusinessDay: boolean }, month: string) {
  const scheduledDate = recurringPostingDate(month, rule.day)
  return rule.adjustToBusinessDay ? previousKoreanBusinessDay(scheduledDate) : scheduledDate
}

export async function getPendingRecurringPostings(householdId: string, month: string): Promise<PendingRecurringPosting[]> {
  const { pending } = await readPostingState(db, householdId, month)
  return Promise.all(pending.map(async rule => ({
    id: rule.id, date: await postingDate(rule, month), memo: recurringMemo(rule, month) ?? '',
    flow: rule.flow, amount: rule.amount,
    category: [rule.major, rule.sub].filter(Boolean).join(' · ') || '미분류',
    account: rule.accountName || '결제수단 미지정',
  })))
}

/** Shared by the legacy full-month action and explicit selection posting. */
export async function postRecurringMonth(householdId: string, month: string, selectedIds?: number[]) {
  return db.transaction(async transaction => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`recurring:${householdId}:${month}`}))`)
    const { dueRules, pending } = await readPostingState(transaction, householdId, month)
    const selected = selectedIds === undefined ? null : new Set(selectedIds)
    if (selected && [...selected].some(id => !dueRules.some(rule => rule.id === id))) {
      return { error: '선택한 정기거래가 변경되었거나 이 달의 반영 대상이 아닙니다. 창을 다시 열어 확인해 주세요.' }
    }
    const selectedPending = pending.filter(rule => !selected || selected.has(rule.id))
    // Resolve every date before writing anything; calendar errors cannot partially post a selection.
    const values = await Promise.all(selectedPending.map(async rule => ({
      householdId, date: await postingDate(rule, month), flow: rule.flow, fixed: rule.fixed,
      categoryId: rule.categoryId, memo: recurringMemo(rule, month), amount: rule.amount,
      accountId: rule.accountId, source: 'recurring', recurringId: rule.id,
      importUid: recurringImportUid(rule.id, month),
    })))
    const closedBefore = await captureClosedMonths(householdId, values.map(row => row.date), transaction)
    const created = values.length === 0 ? [] : await transaction.insert(transactions).values(values)
      .onConflictDoNothing({ target: [transactions.householdId, transactions.importUid] })
      .returning({ id: transactions.id })
    // Re-read posting identities to include concurrent/imported conflicts in the remaining count.
    const after = await readPostingState(transaction, householdId, month)
    return {
      added: created.length, skipped: (selected?.size ?? dueRules.length) - created.length,
      remaining: after.pending.length, pendingIds: after.pending.map(rule => rule.id),
      handledIds: [...(selected ?? new Set(dueRules.map(rule => rule.id)))],
      notice: await reopenedMonthNotice(householdId, closedBefore, transaction),
    }
  })
}
