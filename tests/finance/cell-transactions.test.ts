import { describe, expect, test } from 'vitest'

import { cellCacheKey } from '@/features/analytics/cell-transactions'

describe('cellCacheKey', () => {
  test('separates a major-only key from a sub key', () => {
    expect(cellCacheKey('식비', null, 6)).not.toBe(cellCacheKey('식비', '', 6))
    expect(cellCacheKey('식비', null, 6)).not.toBe(cellCacheKey('식비', '장보기', 6))
  })

  test('does not collide when a name contains the separator characters', () => {
    expect(cellCacheKey('식비:6', null, 1)).not.toBe(cellCacheKey('식비', null, 6))
    expect(cellCacheKey('a', 'b:c', 1)).not.toBe(cellCacheKey('a:b', 'c', 1))
  })

  test('is stable for the same cell', () => {
    expect(cellCacheKey('식비', '장보기', 6)).toBe(cellCacheKey('식비', '장보기', 6))
  })
})
