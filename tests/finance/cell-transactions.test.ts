import { describe, expect, test } from 'vitest'

import { cellCacheKey } from '@/features/analytics/cell-transactions'

function cell(overrides: Partial<Parameters<typeof cellCacheKey>[0]> = {}) {
  return {
    flow: 'expense' as const,
    year: 2026,
    month: 6,
    major: '식비',
    sub: null as string | null,
    closed: false,
    revision: 0,
    ...overrides,
  }
}

describe('cellCacheKey', () => {
  test('separates a major-only key from a sub key', () => {
    expect(cellCacheKey(cell({ sub: null }))).not.toBe(cellCacheKey(cell({ sub: '' })))
    expect(cellCacheKey(cell({ sub: null }))).not.toBe(cellCacheKey(cell({ sub: '장보기' })))
  })

  test('does not collide when a name contains the separator characters', () => {
    expect(cellCacheKey(cell({ major: '식비:6', month: 1 }))).not.toBe(cellCacheKey(cell({ major: '식비', month: 6 })))
    expect(cellCacheKey(cell({ major: 'a', sub: 'b:c', month: 1 }))).not.toBe(cellCacheKey(cell({ major: 'a:b', sub: 'c', month: 1 })))
  })

  test('is stable for the same cell', () => {
    expect(cellCacheKey(cell({ sub: '장보기' }))).toBe(cellCacheKey(cell({ sub: '장보기' })))
  })

  test('separates the same major, year and month across flows', () => {
    expect(cellCacheKey(cell({ flow: 'expense' }))).not.toBe(cellCacheKey(cell({ flow: 'income' })))
  })

  test('separates the same major, flow and month across years', () => {
    expect(cellCacheKey(cell({ year: 2025 }))).not.toBe(cellCacheKey(cell({ year: 2026 })))
  })

  test('separates a live month from the same month closed, and each closed revision', () => {
    expect(cellCacheKey(cell({ closed: false, revision: 0 }))).not.toBe(cellCacheKey(cell({ closed: true, revision: 0 })))
    expect(cellCacheKey(cell({ closed: true, revision: 2 }))).not.toBe(cellCacheKey(cell({ closed: true, revision: 3 })))
  })

  test('ignores the revision of a month that is not closed', () => {
    expect(cellCacheKey(cell({ closed: false, revision: 2 }))).toBe(cellCacheKey(cell({ closed: false, revision: 9 })))
  })
})
