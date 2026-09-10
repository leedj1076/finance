import { describe, expect, test } from 'vitest'

import { parseBudgetSaveRequest } from '@/features/budgets/save-contract'

const recommendationJobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function validRequest(): Record<string, unknown> {
  return {
    month: '2026-09',
    changes: [{
      major: '식비',
      amount: 723_693,
      recommendationJobId,
      expectedVersion: 'food-v1',
    }],
    targetChange: { value: 30, expectedVersion: 'target-v1' },
    acknowledgeOverage: false,
  }
}

describe('parseBudgetSaveRequest', () => {
  test('accepts the exact contract including a real end-user amount and nullable provenance', () => {
    expect(parseBudgetSaveRequest(validRequest())).toEqual(validRequest())

    const targetOnly = { ...validRequest(), changes: [], targetChange: null, acknowledgeOverage: true }
    expect(parseBudgetSaveRequest(targetOnly)).toEqual(targetOnly)

    const manual = validRequest()
    manual.changes = [{
      major: '교통', amount: 0, recommendationJobId: null, expectedVersion: 'opaque:version:2',
    }]
    expect(parseBudgetSaveRequest(manual)).toEqual(manual)
  })

  test('accepts exactly 500 unique changes', () => {
    const input = validRequest()
    input.changes = Array.from({ length: 500 }, (_, index) => ({
      major: `분류${index}`,
      amount: index,
      recommendationJobId: null,
      expectedVersion: `v${index}`,
    }))
    expect(parseBudgetSaveRequest(input).changes).toHaveLength(500)
  })

  test.each([
    ['null root', null],
    ['array root', []],
    ['unknown root key', { ...validRequest(), prompt: 'private' }],
    ['missing root key', (() => { const value = validRequest(); delete value.acknowledgeOverage; return value })()],
    ['invalid month', { ...validRequest(), month: '2026-13' }],
    ['non-array changes', { ...validRequest(), changes: {} }],
    ['more than 500 changes', { ...validRequest(), changes: Array.from({ length: 501 }, (_, index) => ({ major: `m${index}`, amount: 1, recommendationJobId: null, expectedVersion: 'v1' })) }],
    ['duplicate majors', { ...validRequest(), changes: [
      { major: '식비', amount: 1, recommendationJobId: null, expectedVersion: 'v1' },
      { major: '식비', amount: 2, recommendationJobId: null, expectedVersion: 'v2' },
    ] }],
    ['empty major', { ...validRequest(), changes: [{ major: '  ', amount: 1, recommendationJobId: null, expectedVersion: 'v1' }] }],
    ['negative amount', { ...validRequest(), changes: [{ major: '식비', amount: -1, recommendationJobId: null, expectedVersion: 'v1' }] }],
    ['fractional amount', { ...validRequest(), changes: [{ major: '식비', amount: 1.5, recommendationJobId: null, expectedVersion: 'v1' }] }],
    ['unsafe amount', { ...validRequest(), changes: [{ major: '식비', amount: Number.MAX_SAFE_INTEGER + 1, recommendationJobId: null, expectedVersion: 'v1' }] }],
    ['NaN amount', { ...validRequest(), changes: [{ major: '식비', amount: Number.NaN, recommendationJobId: null, expectedVersion: 'v1' }] }],
    ['wrong UUID', { ...validRequest(), changes: [{ major: '식비', amount: 1, recommendationJobId: 'not-a-uuid', expectedVersion: 'v1' }] }],
    ['empty version', { ...validRequest(), changes: [{ major: '식비', amount: 1, recommendationJobId: null, expectedVersion: '  ' }] }],
    ['unknown change key', { ...validRequest(), changes: [{ major: '식비', amount: 1, recommendationJobId: null, expectedVersion: 'v1', note: 'private' }] }],
    ['missing change key', { ...validRequest(), changes: [{ major: '식비', amount: 1, recommendationJobId: null }] }],
    ['unknown target key', { ...validRequest(), targetChange: { value: 30, expectedVersion: 'v1', note: 'private' } }],
    ['missing target key', { ...validRequest(), targetChange: { value: 30 } }],
    ['target below zero', { ...validRequest(), targetChange: { value: -1, expectedVersion: 'v1' } }],
    ['target above 80', { ...validRequest(), targetChange: { value: 81, expectedVersion: 'v1' } }],
    ['fractional target', { ...validRequest(), targetChange: { value: 30.5, expectedVersion: 'v1' } }],
    ['empty target version', { ...validRequest(), targetChange: { value: 30, expectedVersion: '' } }],
    ['non-boolean acknowledgment', { ...validRequest(), acknowledgeOverage: 1 }],
  ])('rejects %s with a safe error', (_name, input) => {
    expect(() => parseBudgetSaveRequest(input)).toThrow('invalid_input')
  })

  test('does not expose rejected input in its error', () => {
    const secret = 'never-echo-this'
    try {
      parseBudgetSaveRequest({ ...validRequest(), secret })
      throw new Error('expected parser to reject')
    } catch (error) {
      expect((error as Error).message).toBe('invalid_input')
      expect((error as Error).message).not.toContain(secret)
    }
  })
})
