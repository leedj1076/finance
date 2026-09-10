import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'

import { boundBudgetEvidence, hashBudgetPayload } from '@/features/budget-recommendations/snapshot'
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
