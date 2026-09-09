import { describe, expect, test } from 'vitest'

import { buildDiagnosisSnapshot, diagnosisFingerprint } from '@/features/diagnosis/snapshot'
import type { DiagnosisTransaction } from '@/features/diagnosis/types'

const row = (id: number, date: string, flow: DiagnosisTransaction['flow'], amount: number, major: string): DiagnosisTransaction => ({ id, date, flow, amount, major, sub: '', merchant: `${major} ${id}` })
const july = [
  row(1, '2026-07-31', 'income', 5_968_470, '월급'),
  row(2, '2026-07-17', 'income', 1_133_250, '월급'),
  row(3, '2026-07-27', 'income', 579_327, '기타수입'),
  row(4, '2026-07-01', 'expense', 5_603_949, '생활'),
  row(5, '2026-07-27', 'saving', 850_000, '연금_노후'),
]

describe('monthly diagnosis snapshot', () => {
  test('separates salary, other income, saving transfers and both remainders', () => {
    const snapshot = buildDiagnosisSnapshot({ month: '2026-07', rows: july, asOf: '2026-09-09T00:00:00.000Z' })
    expect(snapshot.current).toMatchObject({ income: 7_681_047, salary: 7_101_720, salaryCount: 2, otherIncome: 579_327, expense: 5_603_949, saving: 850_000, salaryRemainder: 647_771, totalRemainder: 1_227_098 })
    expect(snapshot.transactions).toHaveLength(5)
  })

  test('does not treat an absent month as a zero-spend comparison', () => {
    const snapshot = buildDiagnosisSnapshot({ month: '2026-07', rows: july })
    expect(snapshot.comparison).toMatchObject({ previousExpense: null, expenseDelta: null, expenseChangeRate: null, baselineMonthCount: 0, expenseAverage: null })
    expect(snapshot.categories[0].previous).toBeNull()
  })

  test('uses the same exclusions on both sides and only recorded months in the baseline', () => {
    const rows = [...july, row(6, '2026-07-02', 'expense', 100, '여행'), row(7, '2026-05-01', 'expense', 200, '경조사'), row(8, '2026-05-01', 'expense', 300, '생활'), row(9, '2026-06-01', 'income', 1000, '급여')]
    const result = buildDiagnosisSnapshot({ month: '2026-07', rows })
    expect(result.comparison).toMatchObject({ previousExpense: 0, expenseChangeRate: null, baselineMonthCount: 2, expenseAverage: 250, comparableExpenseAverage: 150 })
    expect(result.current.comparableExpense).toBe(5_603_949)
  })

  test('keeps all monthly totals when bounded evidence omits smaller rows', () => {
    const rows = Array.from({ length: 401 }, (_, i) => row(i + 1, '2026-07-01', 'expense', 100, '생활'))
    const result = buildDiagnosisSnapshot({ month: '2026-07', rows })
    expect(result.current.count).toBe(401)
    expect(result.current.expense).toBe(40_100)
    expect(result.transactions.length).toBeLessThan(401)
    expect(result.evidenceCount).toBe(result.transactions.length)
  })

  test('fingerprint ignores capture time and source order but detects edits and budget changes', () => {
    const first = buildDiagnosisSnapshot({ month: '2026-07', rows: july, asOf: '2026-09-09T00:00:00Z' })
    const later = buildDiagnosisSnapshot({ month: '2026-07', rows: [...july].reverse(), asOf: '2026-09-10T00:00:00Z' })
    expect(diagnosisFingerprint(first)).toBe(diagnosisFingerprint(later))
    const edit = buildDiagnosisSnapshot({ month: '2026-07', rows: july.map(t => t.id === 4 ? { ...t, amount: t.amount + 1 } : t) })
    expect(diagnosisFingerprint(first)).not.toBe(diagnosisFingerprint(edit))
    const budget = buildDiagnosisSnapshot({ month: '2026-07', rows: july, budgetRows: [{ major: '생활', month: '*', amount: 1 }] })
    expect(diagnosisFingerprint(first)).not.toBe(diagnosisFingerprint(budget))
  })

  test('a missing salary category is represented explicitly and refunds remain signed', () => {
    const result = buildDiagnosisSnapshot({ month: '2026-07', rows: [row(1, '2026-07-01', 'expense', 100, '식비'), row(2, '2026-07-02', 'expense', -20, '식비')] })
    expect(result.current).toMatchObject({ salaryCount: 0, expense: 80, salaryRemainder: -80, savingsRate: null })
  })

  test('month-specific budgets replace defaults including explicit zero', () => {
    const result = buildDiagnosisSnapshot({ month: '2026-07', rows: july, budgetRows: [{ major: '생활', month: '*', amount: 999 }, { major: '생활', month: '2026-07', amount: 0 }] })
    expect(result.budget.total).toBe(0)
    expect(result.categories[0].budget).toBe(0)
  })
})
