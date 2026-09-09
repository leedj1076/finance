import { createHash } from 'node:crypto'

import { isMonthKey, shiftMonth } from '../../lib/finance'
import type { DiagnosisMonth, DiagnosisSnapshot, DiagnosisTransaction } from './types'

export type DiagnosisBudgetRow = { major: string; month: string; amount: number }
const SALARY_CATEGORIES = new Set(['월급', '급여'])
const COMPARISON_EXCLUSIONS = new Set(['여행', '경조사'])
export const DIAGNOSIS_EVIDENCE_LIMIT = 300

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const total = (rows: DiagnosisTransaction[], flow: DiagnosisTransaction['flow']) => rows.filter(row => row.flow === flow).reduce((sum, row) => sum + row.amount, 0)

export function buildDiagnosisSnapshot({ month, rows, budgetRows = [], savingsRateTarget = null, asOf = new Date().toISOString(), sourceRevision }: {
  month: string
  rows: DiagnosisTransaction[]
  budgetRows?: DiagnosisBudgetRow[]
  savingsRateTarget?: number | null
  asOf?: string
  sourceRevision?: string
}): DiagnosisSnapshot {
  if (!isMonthKey(month)) throw new Error('Invalid diagnosis month')
  const firstMonth = shiftMonth(month, -3)
  const endMonth = shiftMonth(month, 1)
  const relevant = rows.filter(row => row.date >= `${firstMonth}-01` && row.date < `${endMonth}-01`)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  if (relevant.some(row => !Number.isSafeInteger(row.amount) || !Number.isSafeInteger(row.id))) throw new Error('Invalid transaction amount or ID')
  const months: DiagnosisMonth[] = [-3, -2, -1, 0].map(offset => {
    const key = shiftMonth(month, offset)
    const entries = relevant.filter(row => row.date.startsWith(key))
    const salary = entries.filter(row => row.flow === 'income' && SALARY_CATEGORIES.has(row.major))
    return {
      month: key, count: entries.length,
      income: total(entries, 'income'), expense: total(entries, 'expense'), saving: total(entries, 'saving'),
      salary: salary.reduce((sum, row) => sum + row.amount, 0), salaryCount: salary.length,
      comparableExpense: total(entries.filter(row => !COMPARISON_EXCLUSIONS.has(row.major)), 'expense'),
    }
  })
  const current = months[3]
  const prior = months[2]
  const baseline = months.slice(0, 3).filter(item => item.count > 0)
  const currentRows = relevant.filter(row => row.date.startsWith(month))
  const priorRows = relevant.filter(row => row.date.startsWith(prior.month))
  const effectiveBudgets = new Map<string, number>()
  for (const key of ['*', month]) {
    for (const budget of budgetRows.filter(row => row.month === key).sort((a, b) => a.major.localeCompare(b.major))) {
      if (Number.isSafeInteger(budget.amount) && budget.amount >= 0) effectiveBudgets.set(budget.major, budget.amount)
    }
  }
  const majors = new Set([...currentRows, ...priorRows].filter(row => row.flow === 'expense').map(row => row.major))
  const categories = [...majors].map(major => {
    const entries = currentRows.filter(row => row.flow === 'expense' && row.major === major)
    const amount = total(entries, 'expense')
    const previous = prior.count ? total(priorRows.filter(row => row.major === major), 'expense') : null
    return { major, amount, previous, delta: previous === null ? null : amount - previous, count: entries.length, budget: effectiveBudgets.get(major) ?? null }
  }).sort((a, b) => b.amount - a.amount || a.major.localeCompare(b.major))

  // Totals always use the complete ledger; bounded source rows are evidence only.
  const evidence = [...currentRows].sort((a, b) => Number(a.flow === 'expense') - Number(b.flow === 'expense') || Math.abs(b.amount) - Math.abs(a.amount) || a.id - b.id)
    .slice(0, DIAGNOSIS_EVIDENCE_LIMIT).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  return {
    version: 1, month, asOf, sourceHash: sourceRevision ?? hash(relevant),
    current: { ...current, otherIncome: current.income - current.salary, salaryRemainder: current.salary - current.expense - current.saving, totalRemainder: current.income - current.expense - current.saving, savingsRate: current.income > 0 ? (current.income - current.expense) / current.income * 100 : null },
    months,
    comparison: {
      previousExpense: prior.count ? prior.expense : null,
      expenseDelta: prior.count ? current.expense - prior.expense : null,
      expenseChangeRate: prior.count && prior.expense > 0 ? (current.expense - prior.expense) / prior.expense * 100 : null,
      baselineMonthCount: baseline.length,
      expenseAverage: baseline.length ? baseline.reduce((sum, item) => sum + item.expense, 0) / baseline.length : null,
      comparableExpenseAverage: baseline.length ? baseline.reduce((sum, item) => sum + item.comparableExpense, 0) / baseline.length : null,
    },
    categories,
    budget: { total: effectiveBudgets.size ? [...effectiveBudgets.values()].reduce((sum, amount) => sum + amount, 0) : null, savingsRateTarget: savingsRateTarget !== null && Number.isFinite(savingsRateTarget) && savingsRateTarget >= 0 && savingsRateTarget <= 100 ? savingsRateTarget : null },
    transactions: evidence,
    evidenceCount: evidence.length,
  }
}

export function diagnosisFingerprint(snapshot: DiagnosisSnapshot) {
  // A fresh read does not itself invalidate a report; changed records do.
  const { asOf: _asOf, ...stable } = snapshot
  void _asOf
  return hash(stable)
}
