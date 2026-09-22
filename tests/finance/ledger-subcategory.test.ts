import { expect, test } from 'vitest'

import { ledgerFiltersFromFormData, ledgerUrl, parseLedgerFilters } from '@/features/ledger/filters'

test('subcategory selection survives tab, sorting and mutation return URLs', () => {
  const filters = parseLedgerFilters({ major: '식비', sub: '카페', account: '12', q: '커피', sort: 'amount-desc' })
  const url = new URL(ledgerUrl('2026-09', filters, { tab: 'list' }), 'http://localhost')
  expect(url.searchParams.get('sub')).toBe('카페')
  expect(url.searchParams.get('account')).toBe('12')
  expect(url.searchParams.get('q')).toBe('커피')
  expect(url.searchParams.get('sort')).toBe('amount-desc')
  const data = new FormData()
  data.set('returnMajor', '식비')
  data.set('returnSub', '카페')
  expect(ledgerFiltersFromFormData(data)).toMatchObject({ major: '식비', sub: '카페' })
})

test('subcategory cannot remain active without a parent category', () => {
  expect(parseLedgerFilters({ sub: '카페' }).sub).toBeUndefined()
  expect(ledgerUrl('2026-09', { account: '', flow: '', major: '', sub: '카페', q: '' })).toBe('/ledger?month=2026-09')
})

test('invalid and oversized subcategory values do not enter navigation', () => {
  for (const sub of [['카페'], 'x'.repeat(101), '']) {
    expect(parseLedgerFilters({ major: '식비', sub }).sub).toBeUndefined()
  }
})
