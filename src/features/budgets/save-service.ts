import 'server-only'

import { createHash } from 'node:crypto'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { budgets, categories, recurring, settings, transactions } from '@/db/schema'
import { safeBudgetSum } from '@/features/budget-recommendations/calculations'
import type { BudgetEvaluation } from '@/features/budget-recommendations/types'
import { recurringIsDue } from '@/features/recurring/calculations'
import { recurringPostingInMonth } from '@/features/recurring/posting-identity'
import { isMonthKey, monthBounds, savingsRate } from '@/lib/finance'
import { readBudgetData, readExpenseMajorNames, type BudgetReader } from './queries'
import { parseBudgetSaveRequest, type BudgetBaseline, type BudgetSaveRequest, type BudgetSaveResult } from './save-contract'
import { spendingCeilingForTarget } from './simulator-calculations'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const budgetScope = (householdId: string, month: string) => and(eq(budgets.householdId, householdId), inArray(budgets.month, ['*', month]))
const targetScope = (householdId: string) => and(eq(settings.householdId, householdId), eq(settings.key, 'savings_target'))

async function readState(reader: BudgetReader, householdId: string, month: string) {
  if (!isMonthKey(month)) throw new Error('invalid_input')
  const [majors, stored, targets] = await Promise.all([
    readExpenseMajorNames(reader, householdId),
    reader.select().from(budgets).where(budgetScope(householdId, month)),
    reader.select().from(settings).where(targetScope(householdId)),
  ])
  const rows: BudgetBaseline[] = majors.map(major => {
    const explicit = stored.find(row => row.major === major && row.month === month) ?? null
    const fallback = explicit ? null : stored.find(row => row.major === major && row.month === '*') ?? null
    const effective = explicit ?? fallback
    return { major, amount: effective?.amount ?? 0, recommendationJobId: effective?.recommendationJobId ?? null,
      version: hash({ householdId, month, major, explicit, fallback }) }
  })
  safeBudgetSum(rows.map(row => row.amount))
  const target = targets[0] ?? null
  const parsed = Number(target?.value ?? 30)
  const savingsTarget = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 80) : 30
  return { stored, target, baseline: { rows, savingsTarget, targetVersion: hash({ householdId, target }) } }
}

/** Opaque versions describe stored presence as well as effective values. */
export async function readBudgetBaselines(reader: BudgetReader, householdId: string, month: string) {
  return (await readState(reader, householdId, month)).baseline
}

/** Manual saving uses money aggregates, without a model snapshot or business-day lookup. */
export async function readBudgetSaveEvaluation(
  reader: BudgetReader, householdId: string, month: string,
  amounts: { major: string; amount: number }[], target?: number,
): Promise<BudgetEvaluation> {
  if (!isMonthKey(month)) throw new Error('invalid_input')
  const { start, end } = monthBounds(month)
  const [canonical, actuals, rules, postings] = await Promise.all([
    readBudgetData(reader, householdId, month),
    reader.select({ major: categories.major, kind: categories.kind, hidden: categories.hidden,
      amount: sql<string>`sum(${transactions.amount})`,
      unsafe: sql<boolean>`bool_or(${transactions.amount} > ${Number.MAX_SAFE_INTEGER} or ${transactions.amount} < ${Number.MIN_SAFE_INTEGER})`,
    }).from(transactions).leftJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)))
      .where(and(eq(transactions.householdId, householdId), eq(transactions.flow, 'expense'), gte(transactions.date, start), lt(transactions.date, end)))
      .groupBy(categories.major, categories.kind, categories.hidden),
    reader.select({ rule: { id: recurring.id, amount: recurring.amount, active: recurring.active,
      startMonth: recurring.startMonth, endMonth: recurring.endMonth },
      major: categories.major, kind: categories.kind, hidden: categories.hidden })
      .from(recurring).leftJoin(categories, and(eq(categories.id, recurring.categoryId), eq(categories.householdId, householdId)))
      .where(and(eq(recurring.householdId, householdId), eq(recurring.active, true), eq(recurring.flow, 'expense'))),
    reader.select({ recurringId: transactions.recurringId }).from(transactions)
      .where(and(eq(transactions.householdId, householdId), recurringPostingInMonth(month))),
  ])
  if (actuals.some(row => row.unsafe)) throw new Error('invalid_amount')
  const majors = new Set(canonical.rows.map(row => row.major))
  const allocatedCategory = (row: { major: string | null; kind: string | null; hidden: boolean | null }) =>
    row.major !== null && majors.has(row.major) && row.kind === 'expense' && row.hidden === false
  const seen = new Set<string>()
  if (amounts.length !== majors.size) throw new Error('invalid_input')
  const rows = amounts.map(row => {
    if (!majors.has(row.major) || seen.has(row.major) || !Number.isSafeInteger(row.amount) || row.amount < 0) throw new Error('invalid_input')
    seen.add(row.major)
    const actual = safeBudgetSum(actuals.filter(value => allocatedCategory(value) && value.major === row.major).map(value => Number(value.amount)))
    return { ...row, remainingAllocation: safeBudgetSum([row.amount, -actual]) }
  })
  const posted = new Set(postings.map(row => row.recurringId))
  const unallocatedReserve = safeBudgetSum([
    ...actuals.filter(row => !allocatedCategory(row)).map(row => Number(row.amount)),
    ...rules.filter(row => recurringIsDue(row.rule, month) && !posted.has(row.rule.id) && !allocatedCategory(row)).map(row => row.rule.amount),
  ])
  const allocated = safeBudgetSum(rows.map(row => row.amount))
  const total = safeBudgetSum([allocated, unallocatedReserve])
  const ceiling = target === undefined ? canonical.spendCeiling : spendingCeilingForTarget({
    averageIncome: canonical.averageIncome, initialSavingsTarget: canonical.savingsTarget,
    savingsTarget: target, serverSpendCeiling: canonical.spendCeiling,
  })
  safeBudgetSum([canonical.averageIncome, 0])
  return { rows, allocated, unallocatedReserve, total, overage: Math.max(0, safeBudgetSum([total, -ceiling])),
    savingsRate: savingsRate(canonical.averageIncome, total) }
}

function isConflict(error: unknown, seen = new Set<object>()): boolean {
  if (!error || typeof error !== 'object' || seen.has(error)) return false
  seen.add(error)
  const item = error as { code?: string; cause?: unknown }
  return ['40001', '40P01', '23505'].includes(item.code ?? '') || isConflict(item.cause, seen)
}

export async function saveBudgetChanges(householdId: string, request: BudgetSaveRequest): Promise<BudgetSaveResult> {
  const input = parseBudgetSaveRequest(request)
  if (input.targetChange && input.changes.some(row => row.recommendationJobId !== null)) throw new Error('save_target_first')
  try {
    return await db.transaction(async tx => {
      // Every save takes locks in this order. Household target changes serialize across months.
      if (input.targetChange) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`budget-target:${householdId}`}, 0))`)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`budget-month:${householdId}:${input.month}`}, 0))`)
      await tx.select({ id: budgets.id }).from(budgets).where(budgetScope(householdId, input.month)).orderBy(budgets.id).for('update')
      await tx.select({ key: settings.key }).from(settings).where(targetScope(householdId)).for(input.targetChange ? 'update' : 'share')
      const current = await readState(tx, householdId, input.month)
      const byMajor = new Map(current.baseline.rows.map(row => [row.major, row]))
      for (const change of input.changes) if (!byMajor.has(change.major)) throw new Error('invalid_input')
      const identical = input.changes.every(change => {
        const row = current.stored.find(row => row.month === input.month && row.major === change.major)
        return row && row.amount === change.amount && row.recommendationJobId === change.recommendationJobId
      }) && (!input.targetChange || current.target !== null && current.baseline.savingsTarget === input.targetChange.value)
      const amounts = new Map(current.baseline.rows.map(row => [row.major, row.amount]))
      if (!identical) {
        for (const change of input.changes) {
          if (byMajor.get(change.major)!.version !== change.expectedVersion) throw new Error('budget_conflict')
          amounts.set(change.major, change.amount)
        }
        if (input.targetChange && current.baseline.targetVersion !== input.targetChange.expectedVersion) throw new Error('budget_conflict')
        const ids = new Set(input.changes.flatMap(row => row.recommendationJobId ? [row.recommendationJobId] : []))
        if (ids.size) {
          const { readApplicableBudgetRecommendation } = await import('@/features/budget-recommendations/service')
          for (const id of ids) {
            const completed = await readApplicableBudgetRecommendation(tx, householdId, input.month, id)
            for (const change of input.changes.filter(row => row.recommendationJobId === id)) {
              if (!completed.report.rows.some(row => row.major === change.major)) throw new Error('invalid_result')
            }
          }
        }
      }
      const evaluation = await readBudgetSaveEvaluation(tx, householdId, input.month,
        [...amounts].map(([major, amount]) => ({ major, amount })), input.targetChange?.value)
      if (!identical) {
        if (evaluation.overage > 0 && !input.acknowledgeOverage) throw new Error('overage_confirmation_required')
        for (const change of input.changes) {
          const stored = current.stored.find(row => row.month === input.month && row.major === change.major)
          if (stored) {
            await tx.update(budgets).set({ amount: change.amount, recommendationJobId: change.recommendationJobId })
              .where(and(eq(budgets.householdId, householdId), eq(budgets.id, stored.id)))
          } else {
            // A direct writer winning a missing-row race must conflict, never be overwritten.
            await tx.insert(budgets).values({ householdId, month: input.month, major: change.major,
              amount: change.amount, recommendationJobId: change.recommendationJobId })
          }
        }
        if (input.targetChange) {
          if (current.target) await tx.update(settings).set({ value: String(input.targetChange.value) }).where(targetScope(householdId))
          else await tx.insert(settings).values({ householdId, key: 'savings_target', value: String(input.targetChange.value) })
        }
      }
      return { ...await readBudgetBaselines(tx, householdId, input.month), total: evaluation.total, overage: evaluation.overage }
    }, { isolationLevel: 'serializable' })
  } catch (error) {
    if (isConflict(error)) throw new Error('budget_conflict')
    throw error
  }
}
