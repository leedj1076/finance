import { expect, test } from 'vitest'

import { ledgerFiltersFromFormData, ledgerUrl, parseLedgerFilters } from '@/features/ledger/filters'

test('keeps supported sort choices in navigation and mutation return URLs', () => {
  for (const sort of ['date-asc', 'amount-desc', 'amount-asc']) {
    const filters = parseLedgerFilters({ flow: 'expense', q: '  coffee ', sort })
    const url = new URL(ledgerUrl('2026-07', filters), 'http://localhost')
    expect(url.searchParams.get('sort')).toBe(sort)
    expect(url.searchParams.get('flow')).toBe('expense')
    expect(url.searchParams.get('q')).toBe('coffee')
    const data = new FormData()
    data.set('returnSort', sort)
    expect(ledgerFiltersFromFormData(data).sort).toBe(sort)
  }
})

test('invalid or absent sort values fall back to newest first without entering a query', () => {
  for (const sort of [undefined, 'date-desc', '', 'amount desc; drop table', ['amount-asc']]) {
    const filters = parseLedgerFilters({ sort })
    expect(ledgerUrl('2026-07', filters)).toBe('/ledger?month=2026-07')
  }
})
