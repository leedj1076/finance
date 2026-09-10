import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'

import { boundBudgetEvidence, hashBudgetPayload } from '@/features/budget-recommendations/snapshot'
import type { BudgetRecommendationSnapshot } from '@/features/budget-recommendations/types'
import { makeBudgetSnapshot } from '../fixtures/budget-recommendation'

test('limiting evidence never limits the financial aggregate', () => {
  const s = makeBudgetSnapshot()
  s.evidence = Array.from({ length: 2100 }, (_, i) => ({
    ...s.evidence[0], id: i + 1, amount: i + 1,
  }))
  s.evidenceCount.total = 2100
  const bounded = boundBudgetEvidence(s)
  expect(bounded.evidence.length).toBeLessThanOrEqual(2000)
  expect(bounded.evidenceCount).toEqual({ total: 2100, provided: bounded.evidence.length })
  expect(bounded.current).toEqual(s.current)
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(1024 * 1024)
  expect(s.evidence).toHaveLength(2100)
})

test('evidence preserves large refunds and recent IDs with deterministic ties and de-duplication', () => {
  const s = makeBudgetSnapshot()
  s.evidence = Array.from({ length: 2200 }, (_, i) => ({
    ...s.evidence[0], id: i + 1, amount: i < 1100 ? -50_000 : 1,
  }))
  s.evidenceCount.total = 2200
  const bounded = boundBudgetEvidence(s)
  expect(bounded.evidence.slice(0, 4).map(row => row.id)).toEqual([1, 2200, 2, 2199])
  expect(bounded.evidence).toHaveLength(2000)
  expect(new Set(bounded.evidence.map(row => row.id)).size).toBe(2000)
  expect(boundBudgetEvidence({ ...s, evidence: [...s.evidence].reverse() })).toEqual(bounded)
})

test('byte bound removes whole evidence entries and rejects oversized aggregate-only input', () => {
  const s = makeBudgetSnapshot()
  s.evidence = Array.from({ length: 20 }, (_, i) => ({ ...s.evidence[0], id: i, merchant: '가'.repeat(30_000) }))
  s.evidenceCount.total = 20
  const bounded = boundBudgetEvidence(s)
  expect(bounded.evidence.length).toBeGreaterThan(0)
  expect(bounded.evidence.length).toBeLessThan(20)
  expect(bounded.evidence[0].merchant).toBe('가'.repeat(30_000))
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(1024 * 1024)
  s.input.notes = '가'.repeat(400_000)
  expect(() => boundBudgetEvidence(s)).toThrow('input_too_large')
})

test('payload hashing is SHA256 of canonical nested object JSON', () => {
  expect(hashBudgetPayload({ z: [{ b: 2, a: 1 }], a: '한글' })).toBe(
    createHash('sha256').update('{"a":"한글","z":[{"a":1,"b":2}]}').digest('hex'),
  )
  expect(hashBudgetPayload({ a: 1, b: 2 })).toBe(hashBudgetPayload({ b: 2, a: 1 }))
})

test('baseline fields count toward the aggregate byte limit', () => {
  const snapshot = makeBudgetSnapshot()
  snapshot.budgetState.current[0].major = '가'.repeat(400_000)
  expect(() => boundBudgetEvidence(snapshot)).toThrow('input_too_large')
})

test.each<[string, (s: BudgetRecommendationSnapshot, value: number) => void]>([
  ['canonical income', (s, value) => { s.basis.averageIncome = value }],
  ['canonical ceiling', (s, value) => { s.basis.spendCeiling = value }],
  ['saved budget', (s, value) => { s.rows[0].savedAmount = value }],
  ['current baseline', (s, value) => { s.budgetState.current[0].amount = value }],
  ['previous baseline', (s, value) => { s.budgetState.previous[0].amount = value }],
  ['previous budget', (s, value) => { s.rows[0].previousBudget = value }],
  ['previous actual', (s, value) => { s.rows[0].previousActual = value }],
  ['historical average', (s, value) => { s.rows[0].average = value }],
  ['historical median', (s, value) => { s.rows[0].median = value }],
  ['current aggregate', (s, value) => { s.current.income = value }],
  ['history aggregate', (s, value) => { s.history[0].saving = value }],
  ['history major', (s, value) => { s.history[0].majors[0].amount = value }],
  ['subcategory', (s, value) => { s.rows[0].subcategories = [{ month: s.month, sub: '장보기', amount: value }] }],
  ['posted recurring', (s, value) => { s.recurring = [{ id: 1, major: '식비', date: '2026-09-01', amount: value, posted: true, memo: '' }] }],
  ['evidence', (s, value) => { s.evidence[0].amount = value }],
  ['draft amount', (s, value) => { s.input.draftAmounts = [{ major: '식비', amount: value }] }],
  ['planned amount', (s, value) => { s.input.plannedExpenses = [{ id: 'planned', major: '식비', amount: value, note: '' }] }],
])('rejects unsafe %s before evidence bounding can emit it', (_name, change) => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, 0.5, Infinity, NaN]) {
    const s = makeBudgetSnapshot()
    change(s, value)
    expect(() => boundBudgetEvidence(s)).toThrow('invalid_amount')
  }
})
