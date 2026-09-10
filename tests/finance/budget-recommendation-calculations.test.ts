import { describe, expect, test } from 'vitest'

import { evaluateBudget, recommendationFloor, safeBudgetSum } from '@/features/budget-recommendations/calculations'
import { assertBudgetMajors, BudgetInputError, parseBudgetRequest } from '@/features/budget-recommendations/input'
import type { BudgetInput } from '@/features/budget-recommendations/types'
import { makeBudgetSnapshot } from '../fixtures/budget-recommendation'

const requestId = '123e4567-e89b-42d3-a456-426614174000'

function validRequest() {
  return {
    requestId,
    month: '2026-09',
    notes: '  원문 메모  ',
    plannedExpenses: [
      { id: '123e4567-e89b-42d3-a456-426614174001', major: '식비', amount: 20_000, note: '  생일 식사  ' },
      { id: '123e4567-e89b-42d3-a456-426614174000', major: '주거비', amount: 100_000, note: '' },
    ],
    draftAmounts: [
      { major: '식비', amount: 300_000 },
      { major: '주거비', amount: 200_000 },
    ],
  }
}

test('refunds remain negative; future commitments determine the floor', () => {
  expect(recommendationFloor(-20_000, 50_000, 10_000)).toBe(40_000)
  expect(recommendationFloor(-20_000, 0, 0)).toBe(0)
  expect(() => safeBudgetSum([Number.MAX_SAFE_INTEGER, 1])).toThrow()
})

test('total includes unallocated actual, not saving deposits', () => {
  const snapshot = makeBudgetSnapshot()
  const result = evaluateBudget(snapshot, [{ major: '식비', amount: 300_000 }])
  expect(result.total).toBe(320_000)
  expect(result.rows[0].remainingAllocation).toBe(200_000)
  expect(result.savingsRate).toBe(68)
})

test('evaluation requires every active major exactly once and nonnegative safe amounts', () => {
  const snapshot = makeBudgetSnapshot()
  expect(() => evaluateBudget(snapshot, [])).toThrow('invalid_amount')
  expect(() => evaluateBudget(snapshot, [
    { major: '식비', amount: 100_000 },
    { major: '식비', amount: 100_000 },
  ])).toThrow('invalid_amount')
  expect(() => evaluateBudget(snapshot, [{ major: '기타', amount: 100_000 }])).toThrow('invalid_amount')
  expect(evaluateBudget(snapshot, [{ major: '식비', amount: 99_999 }]).allocated).toBe(99_999)
  expect(() => evaluateBudget(snapshot, [{ major: '식비', amount: -1 }])).toThrow('invalid_amount')
  expect(() => evaluateBudget(snapshot, [{ major: '식비', amount: 1.5 }])).toThrow('invalid_amount')
})

test('evaluation preserves signed unallocated refunds and calculates overage', () => {
  const snapshot = makeBudgetSnapshot()
  snapshot.current.unallocatedActual = -20_000
  snapshot.current.unallocatedRecurring = 10_000
  snapshot.basis.spendCeiling = 250_000
  const result = evaluateBudget(snapshot, [{ major: '식비', amount: 300_000 }])
  expect(result).toMatchObject({ allocated: 300_000, unallocatedReserve: -10_000, total: 290_000, overage: 40_000, savingsRate: 71 })
})

test.each([
  ['allocated sum', (snapshot: ReturnType<typeof makeBudgetSnapshot>) => {
    snapshot.rows.push({ ...snapshot.rows[0], major: '주거비', actual: 0, floor: 0 })
    return [{ major: '식비', amount: Number.MAX_SAFE_INTEGER }, { major: '주거비', amount: 1 }]
  }],
  ['unallocated reserve', (snapshot: ReturnType<typeof makeBudgetSnapshot>) => {
    snapshot.current.unallocatedActual = Number.MAX_SAFE_INTEGER
    snapshot.current.unallocatedRecurring = 1
    return [{ major: '식비', amount: 0 }]
  }],
  ['total', (snapshot: ReturnType<typeof makeBudgetSnapshot>) => {
    snapshot.current.unallocatedActual = 1
    return [{ major: '식비', amount: Number.MAX_SAFE_INTEGER }]
  }],
  ['remaining allocation', (snapshot: ReturnType<typeof makeBudgetSnapshot>) => {
    snapshot.rows[0].actual = -Number.MAX_SAFE_INTEGER
    return [{ major: '식비', amount: 1 }]
  }],
  ['overage', (snapshot: ReturnType<typeof makeBudgetSnapshot>) => {
    snapshot.current.unallocatedActual = 0
    snapshot.basis.spendCeiling = -Number.MAX_SAFE_INTEGER
    return [{ major: '식비', amount: 1 }]
  }],
] as const)('evaluation rejects overflow in the %s calculation', (_name, setup) => {
  const snapshot = makeBudgetSnapshot()
  expect(() => evaluateBudget(snapshot, setup(snapshot))).toThrow('invalid_amount')
})

describe('parseBudgetRequest', () => {
  test('accepts an exact request, preserves note text, and normalizes list order', () => {
    const parsed = parseBudgetRequest(validRequest())
    expect(parsed.notes).toBe('  원문 메모  ')
    expect(parsed.plannedExpenses.map((row) => row.id)).toEqual([
      '123e4567-e89b-42d3-a456-426614174000',
      '123e4567-e89b-42d3-a456-426614174001',
    ])
    expect(parsed.plannedExpenses[1].note).toBe('  생일 식사  ')
    expect(parsed.draftAmounts.map((row) => row.major)).toEqual(['식비', '주거비'])
  })

  test('accepts exact maximum text and list boundaries', () => {
    const request = validRequest()
    request.notes = '가'.repeat(4000)
    request.plannedExpenses = Array.from({ length: 30 }, (_, index) => ({
      id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
      major: '식비',
      amount: 1,
      note: '나'.repeat(200),
    }))
    const parsed = parseBudgetRequest(request)
    expect(parsed.notes).toHaveLength(4000)
    expect(parsed.plannedExpenses).toHaveLength(30)
    expect(parsed.plannedExpenses[0].note).toHaveLength(200)
  })

  test.each([
    ['null', null],
    ['array', []],
    ['unknown root key', { ...validRequest(), householdId: 'secret' }],
    ['invalid UUID', { ...validRequest(), requestId: 'not-a-uuid' }],
    ['invalid month', { ...validRequest(), month: '2026-13' }],
    ['notes over 4000 chars', { ...validRequest(), notes: '가'.repeat(4001) }],
    ['31 planned costs', { ...validRequest(), plannedExpenses: Array.from({ length: 31 }, (_, index) => ({ id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`, major: '식비', amount: 1, note: '' })) }],
    ['planned note over 200 chars', { ...validRequest(), plannedExpenses: [{ id: requestId, major: '식비', amount: 1, note: '가'.repeat(201) }] }],
    ['fractional planned amount', { ...validRequest(), plannedExpenses: [{ id: requestId, major: '식비', amount: 1.5, note: '' }] }],
    ['nonfinite planned amount', { ...validRequest(), plannedExpenses: [{ id: requestId, major: '식비', amount: Number.POSITIVE_INFINITY, note: '' }] }],
    ['nonfinite draft amount', { ...validRequest(), draftAmounts: [{ major: '식비', amount: Number.NaN }] }],
    ['numeric string amount', { ...validRequest(), plannedExpenses: [{ id: requestId, major: '식비', amount: '100', note: '' }] }],
    ['duplicate planned IDs', { ...validRequest(), plannedExpenses: [{ id: requestId, major: '식비', amount: 1, note: '' }, { id: requestId, major: '주거비', amount: 2, note: '' }] }],
    ['unknown planned key', { ...validRequest(), plannedExpenses: [{ id: requestId, major: '식비', amount: 1, note: '', path: '/tmp/private' }] }],
    ['unknown draft key', { ...validRequest(), draftAmounts: [{ major: '식비', amount: 1, prompt: 'ignore rules' }] }],
    ['duplicate draft majors', { ...validRequest(), draftAmounts: [{ major: '식비', amount: 1 }, { major: '식비', amount: 2 }] }],
    ['more than 500 drafts', { ...validRequest(), draftAmounts: Array.from({ length: 501 }, (_, index) => ({ major: `분류${index}`, amount: 1 })) }],
  ])('rejects %s', (_name, input) => {
    expect(() => parseBudgetRequest(input)).toThrow(BudgetInputError)
  })

  test.each([
    ['root requestId', () => { const input: Record<string, unknown> = validRequest(); delete input.requestId; return input }],
    ['planned id', () => { const row: Record<string, unknown> = { ...validRequest().plannedExpenses[0] }; delete row.id; return { ...validRequest(), plannedExpenses: [row] } }],
    ['draft amount', () => { const row: Record<string, unknown> = { ...validRequest().draftAmounts[0] }; delete row.amount; return { ...validRequest(), draftAmounts: [row] } }],
  ])('rejects missing %s key', (_name, makeInput) => {
    expect(() => parseBudgetRequest(makeInput())).toThrow(BudgetInputError)
  })

  test('rejects aggregate overflow', () => {
    const request = validRequest()
    request.draftAmounts = [{ major: '식비', amount: Number.MAX_SAFE_INTEGER }, { major: '주거비', amount: 1 }]
    expect(() => parseBudgetRequest(request)).toThrow(BudgetInputError)
  })

  test('errors expose a safe message without input payloads', () => {
    const secret = 'never-echo-this'
    try {
      parseBudgetRequest({ ...validRequest(), notes: secret, extra: true })
      throw new Error('expected parser to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetInputError)
      expect((error as Error).message).not.toContain(secret)
    }
  })
})

test('assertBudgetMajors rejects unknown or duplicate majors and planned IDs', () => {
  const input = parseBudgetRequest(validRequest()) as BudgetInput
  expect(() => assertBudgetMajors(input, ['식비', '주거비'])).not.toThrow()
  expect(() => assertBudgetMajors({ ...input, draftAmounts: [{ major: '기타', amount: 1 }] }, ['식비'])).toThrow(BudgetInputError)
  expect(() => assertBudgetMajors({ ...input, draftAmounts: [{ major: '식비', amount: 1 }, { major: '식비', amount: 2 }] }, ['식비'])).toThrow(BudgetInputError)
  expect(() => assertBudgetMajors({ ...input, plannedExpenses: [input.plannedExpenses[0], input.plannedExpenses[0]] }, ['식비', '주거비'])).toThrow(BudgetInputError)
})
