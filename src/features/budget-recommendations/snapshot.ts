import { createHash } from 'node:crypto'
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm'

import { budgets, categories, categoryMeta, importInbox, recurring, transactions } from '@/db/schema'
import { canonicalAiJson } from '@/features/ai-settings/prompt'
import { todayInKorea } from '@/features/budgets/pace'
import { readBudgetData, type BudgetReader } from '@/features/budgets/queries'
import { readBudgetReviewData } from '@/features/budgets/review-queries'
import { readMonthStatuses } from '@/features/month-close/queries'
import { previousKoreanBusinessDay } from '@/features/recurring/business-days'
import { recurringIsDue, recurringMemo, recurringPostingDate } from '@/features/recurring/calculations'
import { recurringPostingInMonth } from '@/features/recurring/posting-identity'
import { currentMonthInKorea, monthBounds, shiftMonth } from '@/lib/finance'

import { recommendationFloor, safeBudgetSum } from './calculations'
import { assertBudgetMajors } from './input'
import type { BudgetEvidence, BudgetInput, BudgetRecommendationSnapshot } from './types'

const EVIDENCE_RANK_LIMIT = 1000
const SNAPSHOT_BYTE_LIMIT = 1024 * 1024
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

export function hashBudgetPayload(value: unknown): string {
  return createHash('sha256').update(canonicalAiJson(value)).digest('hex')
}

export function boundBudgetEvidence(snapshot: BudgetRecommendationSnapshot): BudgetRecommendationSnapshot {
  const candidates = [...new Map(snapshot.evidence.map(row => [row.id, row])).values()]
  const largest = [...candidates].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.id - b.id)
    .slice(0, EVIDENCE_RANK_LIMIT)
  const recent = [...candidates].sort((a, b) => b.id - a.id).slice(0, EVIDENCE_RANK_LIMIT)
  const evidence: BudgetEvidence[] = []
  const seen = new Set<number>()
  for (let i = 0; i < Math.max(largest.length, recent.length); i += 1) {
    for (const row of [largest[i], recent[i]]) {
      if (row && !seen.has(row.id)) {
        seen.add(row.id)
        evidence.push(row)
      }
    }
  }
  const result = { ...snapshot, evidence, evidenceCount: { total: snapshot.evidenceCount.total, provided: evidence.length } }
  // Remove entire entries: titles and notes remain exact evidence, even at the byte limit.
  while (Buffer.byteLength(JSON.stringify(result), 'utf8') > SNAPSHOT_BYTE_LIMIT) {
    if (!result.evidence.length) throw new Error('input_too_large')
    result.evidence.pop()
    result.evidenceCount.provided = result.evidence.length
  }
  return result
}

async function transactionDigest(reader: BudgetReader, householdId: string, start: string, end: string) {
  const [row] = await reader.select({
    digest: sql<string>`encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(
      ${transactions.id}, ${transactions.date}, ${transactions.flow}, ${transactions.amount},
      ${transactions.categoryId}, ${transactions.accountId}, ${transactions.fixed}, ${transactions.memo},
      ${transactions.rawMerchant}, ${transactions.recurringId}, ${transactions.importUid}
    ) order by ${transactions.id}), '[]'::jsonb)::text, 'UTF8')), 'hex')`,
  }).from(transactions).where(and(eq(transactions.householdId, householdId), gte(transactions.date, start), lt(transactions.date, end)))
  return row.digest
}

/** The caller owns a repeatable-read or serializable transaction for this reader. */
export async function readBudgetSnapshot(
  reader: BudgetReader,
  householdId: string,
  input: BudgetInput,
  now = new Date(),
): Promise<BudgetRecommendationSnapshot> {
  const month = input.month
  const historyMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 6))
  const start = `${historyMonths[0]}-01`
  const { start: currentStart, end } = monthBounds(month)
  const currentMonth = currentMonthInKorea(now)
  const asOfDate = todayInKorea(now)
  const scope = and(eq(transactions.householdId, householdId), gte(transactions.date, start), lt(transactions.date, end))
  const categoryJoin = and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId))
  const monthExpression = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`
  const evidenceSelection = {
    id: transactions.id, date: transactions.date, flow: transactions.flow, amount: transactions.amount,
    major: categories.major, sub: categories.sub,
    merchant: sql<string>`coalesce(${transactions.rawMerchant}, ${transactions.memo}, '')`,
  }
  const readEvidence = (order: SQL[]) => reader.select(evidenceSelection).from(transactions)
    .leftJoin(categories, categoryJoin).where(scope).orderBy(...order).limit(EVIDENCE_RANK_LIMIT)

  const [canonical, review, statuses, categoryRows, metadata, aggregates, rules, postings,
    largestEvidence, recentEvidence, pendingRows, unclassifiedRows, rangeDigest, budgetRows] = await Promise.all([
    readBudgetData(reader, householdId, month, now),
    readBudgetReviewData(reader, householdId, month, now),
    readMonthStatuses(reader, householdId, [...historyMonths, month]),
    reader.select().from(categories).where(eq(categories.householdId, householdId)).orderBy(categories.id),
    reader.select().from(categoryMeta).where(eq(categoryMeta.householdId, householdId)).orderBy(categoryMeta.major),
    reader.select({
      month: monthExpression, flow: transactions.flow, major: categories.major, sub: categories.sub,
      hidden: categories.hidden, kind: categories.kind,
      amount: sql<string>`sum(${transactions.amount})`, count: sql<string>`count(*)`,
    }).from(transactions).leftJoin(categories, categoryJoin).where(scope)
      .groupBy(monthExpression, transactions.flow, categories.major, categories.sub, categories.hidden, categories.kind)
      .orderBy(monthExpression, transactions.flow, categories.major, categories.sub),
    reader.select().from(recurring).where(and(eq(recurring.householdId, householdId), eq(recurring.active, true), eq(recurring.flow, 'expense')))
      .orderBy(recurring.id),
    reader.select({ id: transactions.id, recurringId: transactions.recurringId, importUid: transactions.importUid, date: transactions.date })
      .from(transactions).where(and(eq(transactions.householdId, householdId), recurringPostingInMonth(month))).orderBy(transactions.id),
    readEvidence([sql`abs(${transactions.amount}) desc`, sql`${transactions.id} asc`]),
    readEvidence([desc(transactions.id)]),
    reader.select({ count: sql<string>`count(*)` }).from(importInbox).where(and(eq(importInbox.householdId, householdId),
      eq(importInbox.status, 'pending'), gte(importInbox.date, currentStart), lt(importInbox.date, end))),
    reader.select({ count: sql<string>`count(*) filter (where ${categories.id} is null or ${categories.major} = '미분류')` })
      .from(transactions).leftJoin(categories, categoryJoin).where(and(eq(transactions.householdId, householdId),
        gte(transactions.date, currentStart), lt(transactions.date, end))),
    transactionDigest(reader, householdId, start, end),
    reader.select({ month: budgets.month, major: budgets.major, amount: budgets.amount }).from(budgets)
      .where(and(eq(budgets.householdId, householdId), sql`${budgets.month} in ('*', ${month}, ${shiftMonth(month, -1)})`))
      .orderBy(budgets.major, budgets.month),
  ])

  const activeMajorNames = canonical.rows.map(row => row.major)
  assertBudgetMajors(input, activeMajorNames)
  const activeMajors = new Set(activeMajorNames)
  const categoryById = new Map(categoryRows.map(row => [row.id, row]))
  const dueRules = rules.filter(rule => recurringIsDue(rule, month))
  const postedIds = new Set(postings.map(row => row.recurringId))
  const recurringRows = await Promise.all(dueRules.map(async rule => {
    const dueDate = recurringPostingDate(input.month, rule.day)
    const date = rule.adjustToBusinessDay ? await previousKoreanBusinessDay(dueDate) : dueDate
    const category = rule.categoryId === null ? undefined : categoryById.get(rule.categoryId)
    return { id: rule.id, major: category?.kind === 'expense' ? category.major : null,
      amount: rule.amount, date, posted: postedIds.has(rule.id), memo: recurringMemo(rule, month) ?? '' }
  }))
  const basis = {
    averageIncome: canonical.averageIncome, savingsTarget: canonical.savingsTarget, spendCeiling: canonical.spendCeiling,
    incomeStart: canonical.incomeBasis.start, incomeEnd: canonical.incomeBasis.end, incomeMonthCount: canonical.incomeBasis.monthCount,
  }
  // This includes expense/saving-only months: they affect the canonical income divisor,
  // as well as all category history used by canonical average/group calculations.
  const incomeBasisDigest = await transactionDigest(reader, householdId, basis.incomeStart, basis.incomeEnd)
  const currentAggregates = aggregates.filter(row => row.month === month)
  const allocated = (row: typeof aggregates[number]) => row.kind === 'expense' && row.hidden === false
    && row.major !== null && activeMajors.has(row.major)
  const amountSum = (rows: { amount: string | number }[]) => safeBudgetSum(rows.map(row => Number(row.amount)))
  const flowTotal = (rows: typeof aggregates, flow: string) => amountSum(rows.filter(row => row.flow === flow))
  const current = {
    income: flowTotal(currentAggregates, 'income'), expense: flowTotal(currentAggregates, 'expense'), saving: flowTotal(currentAggregates, 'saving'),
    unallocatedActual: amountSum(currentAggregates.filter(row => row.flow === 'expense' && !allocated(row))),
    unallocatedRecurring: amountSum(recurringRows.filter(row => !row.posted && (row.major === null || !activeMajors.has(row.major)))),
  }
  const reviewByMajor = new Map(review.rows.map(row => [row.major, row]))
  const rows = canonical.rows.map(row => {
    const historical = reviewByMajor.get(row.major)!
    const actual = amountSum(currentAggregates.filter(value => value.flow === 'expense' && allocated(value) && value.major === row.major))
    const unpostedRecurring = amountSum(recurringRows.filter(value => value.major === row.major && !value.posted))
    const planned = amountSum(input.plannedExpenses.filter(value => value.major === row.major))
    return {
      major: row.major, group: row.group as 'fixed' | 'variable' | 'irregular', savedAmount: row.budget, savedRecommendationJobId: null,
      actual, unpostedRecurring, planned, floor: recommendationFloor(actual, unpostedRecurring, planned),
      previousBudget: historical.previousBudget, previousActual: historical.previousActual, average: row.average, median: historical.median,
      subcategories: aggregates.filter(value => value.flow === 'expense' && allocated(value) && value.major === row.major)
        .map(value => ({ sub: value.sub!, month: value.month, amount: Number(value.amount) })),
    }
  }).sort((a, b) => compareText(a.major, b.major))
  const statusByMonth = new Map(statuses.map(row => [row.month, row]))
  const history = historyMonths.map(key => {
    const monthly = aggregates.filter(row => row.month === key)
    const majors = new Map<string, number>()
    for (const row of monthly.filter(row => row.flow === 'expense')) {
      const major = row.major ?? '미분류'
      majors.set(major, safeBudgetSum([majors.get(major) ?? 0, Number(row.amount)]))
    }
    return {
      month: key, state: statusByMonth.get(key)!.state, hasRecords: monthly.length > 0, partial: key === currentMonth,
      income: flowTotal(monthly, 'income'), expense: flowTotal(monthly, 'expense'), saving: flowTotal(monthly, 'saving'),
      majors: [...majors].map(([major, amount]) => ({ major, amount })).sort((a, b) => compareText(a.major, b.major)),
    }
  })
  const pendingCount = Number(pendingRows[0].count)
  const unclassifiedCount = Number(unclassifiedRows[0].count)
  const sourceHash = hashBudgetPayload({ month, asOfDate, basis, rangeDigest, incomeBasisDigest,
    categories: categoryRows, metadata, dueRules, postings, recurring: recurringRows, statuses, pendingCount, unclassifiedCount })
  const effectiveBudget = (target: string, major: string) => {
    const saved = budgetRows.find(row => row.month === target && row.major === major)
      ?? budgetRows.find(row => row.month === '*' && row.major === major)
    return { major, amount: saved?.amount ?? 0, sourceMonth: saved?.month ?? null, recommendationJobId: null }
  }
  const budgetHash = hashBudgetPayload({ month,
    current: rows.map(row => effectiveBudget(month, row.major)),
    previous: rows.map(row => effectiveBudget(shiftMonth(month, -1), row.major)),
  })
  // Construct a fresh input so a requestId supplied structurally by a caller is never hashed.
  const sortedInput: BudgetInput = { month, notes: input.notes,
    plannedExpenses: [...input.plannedExpenses].sort((a, b) => compareText(a.id, b.id)),
    draftAmounts: [...input.draftAmounts].sort((a, b) => compareText(a.major, b.major)) }
  const fingerprint = hashBudgetPayload({ sourceHash, budgetHash, notes: sortedInput.notes,
    plannedExpenses: sortedInput.plannedExpenses, unsavedDraft: { kind: 'unsaved', amounts: sortedInput.draftAmounts } })
  return boundBudgetEvidence({ version: 1, month, asOfDate, sourceHash, budgetHash, fingerprint, input: sortedInput,
    basis, current, rows, history, recurring: recurringRows,
    evidence: [...largestEvidence, ...recentEvidence],
    evidenceCount: { total: safeBudgetSum(aggregates.map(row => Number(row.count))), provided: 0 }, pendingCount, unclassifiedCount })
}
