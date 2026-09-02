import { expect, test } from 'vitest'

import { buildAmountRepeatIndex } from '@/features/inbox/banksalad'
import { assessConfidence } from '@/features/inbox/confidence'
import { normalizeMerchant } from '@/features/inbox/normalize'

const base = {
  sugSource: 'history' as const,
  historyMatch: 'norm' as const,
  alwaysConfirm: false,
  hasDup: false,
  kind: 'normal' as const,
  categoryId: 1,
  exactAmountRepeat: false,
}

test('normal history norm matches and user cache suggestions are high confidence', () => {
  expect(assessConfidence(base)).toBe('high')
  expect(assessConfidence({ ...base, sugSource: 'user', historyMatch: null })).toBe('high')
})

test('token history, AI, banksalad, and blank suggestions require review', () => {
  expect(assessConfidence({ ...base, historyMatch: 'token' })).toBe('review')
  expect(assessConfidence({ ...base, sugSource: 'ai', historyMatch: null })).toBe('review')
  expect(assessConfidence({ ...base, sugSource: 'banksalad', historyMatch: null })).toBe('review')
  expect(assessConfidence({
    ...base,
    sugSource: null,
    historyMatch: null,
    categoryId: null,
  })).toBe('review')
})

test('aggregators require review unless an exact amount has a repeat category', () => {
  expect(assessConfidence({ ...base, alwaysConfirm: true })).toBe('review')
  expect(assessConfidence({
    ...base,
    alwaysConfirm: true,
    exactAmountRepeat: true,
  })).toBe('high')
})

test('duplicate, transfer, and uncategorized rows always require review', () => {
  expect(assessConfidence({ ...base, hasDup: true })).toBe('review')
  expect(assessConfidence({ ...base, kind: 'transfer' })).toBe('review')
  expect(assessConfidence({ ...base, categoryId: null })).toBe('review')
  expect(assessConfidence({
    ...base,
    alwaysConfirm: true,
    exactAmountRepeat: true,
    hasDup: true,
  })).toBe('review')
})

test('buildAmountRepeatIndex keeps only 2+ repeats and requires a single category', () => {
  const rows = [
    { merchant: '배민클럽_우아한형제들', amount: 1_990, categoryId: 5 },
    { merchant: '배민클럽_우아한형제들', amount: 1_990, categoryId: 5 },
    { merchant: '쿠팡', amount: 30_000, categoryId: 7 },
    { merchant: '쿠팡', amount: 30_000, categoryId: 9 },
    { merchant: '쿠팡', amount: 12_345, categoryId: 7 },
    { merchant: '   ', amount: 1_000, categoryId: 1 },
    { merchant: '   ', amount: 1_000, categoryId: 1 },
  ]

  const index = buildAmountRepeatIndex(rows)
  const subscriptionKey = `${normalizeMerchant('배민클럽_우아한형제들')}|1990`
  const mixedCategoryKey = `${normalizeMerchant('쿠팡')}|30000`

  expect(index.get(subscriptionKey)).toEqual({ count: 2, categoryId: 5 })
  expect(index.get(mixedCategoryKey)).toEqual({ count: 2, categoryId: null })
  expect(index.has(`${normalizeMerchant('쿠팡')}|12345`)).toBe(false)
  expect(index.has('|1000')).toBe(false)
})
