import { expect, test } from 'vitest'

import { compositionShares } from '@/features/assets/composition'

test('share is a percentage of the total, not of the largest row', () => {
  const rows = [{ major: '저축·투자', amount: 226_002_181 }, { major: '현금', amount: 54_677_597 }]
  const shares = compositionShares(rows).map((row) => Number(row.share.toFixed(1)))
  expect(shares).toEqual([80.5, 19.5])
})

test('shares add up to 100 across many rows', () => {
  const rows = [{ amount: 100 }, { amount: 300 }, { amount: 600 }]
  expect(compositionShares(rows).map((row) => row.share)).toEqual([10, 30, 60])
})

test('an empty or non-positive total yields zero shares instead of NaN', () => {
  expect(compositionShares([])).toEqual([])
  expect(compositionShares([{ amount: 0 }, { amount: 0 }]).map((row) => row.share)).toEqual([0, 0])
})

test('negative amounts count as nothing rather than flipping the bar', () => {
  const shares = compositionShares([{ amount: 75 }, { amount: -25 }]).map((row) => row.share)
  expect(shares).toEqual([100, 0])
})
