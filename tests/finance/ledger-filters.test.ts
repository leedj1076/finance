import { describe, expect, test } from 'vitest'

import {
  hasLedgerFilters,
  ledgerUrl,
  parseLedgerFilters,
} from '@/features/ledger/filters'

describe('ledger filters', () => {
  test('accepts the four supported filters and trims the query', () => {
    const filters = parseLedgerFilters({
      account: '12',
      flow: 'expense',
      major: '식비',
      q: '  장보기  ',
    })

    expect(filters).toEqual({ account: '12', flow: 'expense', major: '식비', q: '장보기' })
    expect(hasLedgerFilters(filters)).toBe(true)
    expect(ledgerUrl('2026-09', filters, { edit: 3 })).toBe(
      '/ledger?month=2026-09&account=12&flow=expense&major=%EC%8B%9D%EB%B9%84&q=%EC%9E%A5%EB%B3%B4%EA%B8%B0&edit=3',
    )
  })

  test('drops invalid account and flow values', () => {
    expect(parseLedgerFilters({ account: 'not-an-id', flow: 'transfer' })).toEqual({
      account: '',
      flow: '',
      major: '',
      q: '',
    })
  })
})
