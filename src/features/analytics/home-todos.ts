import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import {
  budgets,
  categories,
  categoryMeta,
  importInbox,
  recurring,
  transactions,
} from '@/db/schema'
import { calculateBudgetPace, type BudgetPaceWarning } from '@/features/budgets/pace'
import { currentMonthInKorea, monthBounds, shiftMonth } from '@/lib/finance'

import { anomalyAlerts, type AnalyticsRow } from './calculations'

export type HomeTodoKind = 'anomaly' | 'pace' | 'inbox' | 'unclassified' | 'review' | 'recurring'

export type HomeTodo = {
  kind: HomeTodoKind
  priority: number
  title: string
  detail: string
  href: string
}

export type HomeTodoInput = {
  month: string
  anomalies: Array<{ major: string; current: number; typical: number }>
  paceWarnings: BudgetPaceWarning[]
  pendingInboxCount: number
  unclassifiedCount: number
  needsReview: boolean
  ungeneratedRecurringCount: number
}

export function buildHomeTodos(input: HomeTodoInput): HomeTodo[] {
  const rows: HomeTodo[] = []
  const anomaly = input.anomalies[0]
  if (anomaly) rows.push({
    kind: 'anomaly',
    priority: 1,
    title: `${anomaly.major} 지출이 평소보다 큽니다`,
    detail: `이번 달 ${anomaly.current.toLocaleString('ko-KR')}원 · 평소 월 ${anomaly.typical.toLocaleString('ko-KR')}원`,
    href: `/ledger?month=${input.month}&tab=list&major=${encodeURIComponent(anomaly.major)}`,
  })

  const pace = input.paceWarnings[0]
  if (pace) rows.push({
    kind: 'pace',
    priority: 2,
    title: `${pace.major} 지출 속도가 빠릅니다`,
    detail: `월말 예상 ${pace.projected.toLocaleString('ko-KR')}원 · 예산보다 ${pace.overrun.toLocaleString('ko-KR')}원 초과`,
    href: `/budgets?month=${input.month}`,
  })

  if (input.pendingInboxCount > 0) rows.push({
    kind: 'inbox',
    priority: 3,
    title: `검토 대기 ${input.pendingInboxCount}건`,
    detail: '가져온 거래를 확인하고 가계부에 반영해 주세요.',
    href: '/inbox',
  })
  if (input.unclassifiedCount > 0) rows.push({
    kind: 'unclassified',
    priority: 4,
    title: `미분류 거래 ${input.unclassifiedCount}건`,
    detail: '분류해야 월간 분석과 예산이 정확해집니다.',
    href: '/inbox?tab=unclassified',
  })
  if (input.needsReview) rows.push({
    kind: 'review',
    priority: 5,
    title: '다음 달 예산을 준비할 때입니다',
    detail: '이번 달을 돌아보고 다음 달 예산을 작성해 주세요.',
    href: `/budgets/review?month=${input.month}`,
  })
  if (input.ungeneratedRecurringCount > 0) rows.push({
    kind: 'recurring',
    priority: 6,
    title: `정기거래 ${input.ungeneratedRecurringCount}건 미반영`,
    detail: '이번 달 원장에 아직 생성되지 않은 정기거래가 있습니다.',
    href: `/ledger?month=${input.month}`,
  })
  return rows.sort((left, right) => left.priority - right.priority)
}

function effectiveBudgetMap(rows: Array<{ major: string; month: string; amount: number }>, month: string) {
  const result = new Map<string, number>()
  rows.filter((row) => row.month === '*').forEach((row) => result.set(row.major, row.amount))
  rows.filter((row) => row.month === month).forEach((row) => result.set(row.major, row.amount))
  return result
}

export async function getHomeTodos(householdId: string) {
  const month = currentMonthInKorea()
  const nextMonth = shiftMonth(month, 1)
  const { end } = monthBounds(month)
  const yearStart = `${month.slice(0, 4)}-01-01`
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })

  const [
    transactionRows,
    budgetRows,
    irregularRows,
    pendingRows,
    unclassifiedRows,
    recurringRows,
    generatedRows,
  ] = await Promise.all([
    db
      .select({
        id: transactions.id,
        date: transactions.date,
        flow: transactions.flow,
        fixed: transactions.fixed,
        amount: transactions.amount,
        major: sql<string>`coalesce(${categories.major}, '미분류')`,
        sub: sql<string>`coalesce(${categories.sub}, '미분류')`,
        merchant: sql<string>`coalesce(nullif(${transactions.rawMerchant}, ''), nullif(${transactions.memo}, ''), '')`,
        accountId: transactions.accountId,
        accountName: sql<string>`''`,
      })
      .from(transactions)
      .leftJoin(
        categories,
        and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)),
      )
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.date, yearStart),
          lt(transactions.date, end),
        ),
      ),
    db
      .select({ major: budgets.major, month: budgets.month, amount: budgets.amount })
      .from(budgets)
      .where(
        and(
          eq(budgets.householdId, householdId),
          inArray(budgets.month, ['*', month, nextMonth]),
        ),
      ),
    db
      .select({ major: categoryMeta.major })
      .from(categoryMeta)
      .where(and(eq(categoryMeta.householdId, householdId), eq(categoryMeta.irregular, true))),
    db
      .select({ value: sql<string>`count(*)` })
      .from(importInbox)
      .where(and(eq(importInbox.householdId, householdId), eq(importInbox.status, 'pending'))),
    db
      .select({ value: sql<string>`count(*)` })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), isNull(transactions.categoryId))),
    db
      .select({ id: recurring.id })
      .from(recurring)
      .where(and(eq(recurring.householdId, householdId), eq(recurring.active, true))),
    db
      .select({ recurringId: transactions.recurringId })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.date, `${month}-01`),
          lt(transactions.date, end),
          sql`${transactions.recurringId} is not null`,
        ),
      ),
  ])

  const rows = transactionRows as AnalyticsRow[]
  const irregularMajors = new Set(irregularRows.map((row) => row.major))
  const budgetMap = effectiveBudgetMap(budgetRows, month)
  const actualByMajor = new Map<string, number>()
  rows.filter((row) => row.flow === 'expense' && row.date.startsWith(month)).forEach((row) => {
    actualByMajor.set(row.major, (actualByMajor.get(row.major) ?? 0) + row.amount)
  })
  const paceWarnings = calculateBudgetPace(
    [...budgetMap].map(([major, budget]) => ({
      major,
      group: irregularMajors.has(major) ? 'irregular' : 'regular',
      budget,
      actual: actualByMajor.get(major) ?? 0,
    })),
    month,
    today,
  )
  const generated = new Set(generatedRows.flatMap((row) => row.recurringId === null ? [] : [row.recurringId]))

  return buildHomeTodos({
    month,
    anomalies: anomalyAlerts(rows, month, irregularMajors),
    paceWarnings,
    pendingInboxCount: Number(pendingRows[0]?.value ?? 0),
    unclassifiedCount: Number(unclassifiedRows[0]?.value ?? 0),
    needsReview: Number(today.slice(8, 10)) >= 25 && !budgetRows.some((row) => row.month === nextMonth),
    ungeneratedRecurringCount: recurringRows.filter((row) => !generated.has(row.id)).length,
  })
}
