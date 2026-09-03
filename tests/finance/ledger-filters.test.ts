import postgres from 'postgres'
import { afterAll, describe, expect, test } from 'vitest'

import {
  hasLedgerFilters,
  ledgerUrl,
  parseLedgerAccountId,
  parseLedgerFilters,
} from '@/features/ledger/filters'
import { getLedgerData, getLedgerShellData } from '@/features/ledger/queries'

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

  test('accepts only positive safe integer account ids', () => {
    expect(parseLedgerAccountId('12')).toBe(12)
    expect(parseLedgerFilters({ account: '0012' }).account).toBe('12')
    for (const invalid of ['', '0', '-1', '1.5', 'not-an-id', '9007199254740992']) {
      expect(parseLedgerAccountId(invalid)).toBeNull()
      expect(parseLedgerFilters({ account: invalid }).account).toBe('')
    }
  })

  test('accepts Flask aliases but gives the web keys priority', () => {
    expect(parseLedgerFilters({ fflow: 'saving', fmajor: '저축_투자' })).toMatchObject({
      flow: 'saving',
      major: '저축_투자',
    })
    expect(parseLedgerFilters({
      flow: 'income',
      fflow: 'expense',
      major: '근로소득',
      fmajor: '식비',
    })).toMatchObject({ flow: 'income', major: '근로소득' })
  })
})

describe('ledger filter database behavior', () => {
  const raw = postgres(process.env.DATABASE_URL!, { prepare: false })
  const householdIds: string[] = []

  afterAll(async () => {
    if (householdIds.length > 0) {
      await raw`delete from households where id in ${raw(householdIds)}`
    }
    await raw.end()
  })

  test('searches memo case-insensitively and rejects unsafe account filters', async () => {
    const suffix = Date.now()
    const [household] = await raw`
      insert into households (name) values (${`ledger-filter-${suffix}`}) returning id
    `
    const [otherHousehold] = await raw`
      insert into households (name) values (${`ledger-filter-other-${suffix}`}) returning id
    `
    householdIds.push(household.id, otherHousehold.id)
    const [accountA] = await raw`
      insert into accounts (household_id, name) values (${household.id}, 'A 카드') returning id
    `
    const [accountB] = await raw`
      insert into accounts (household_id, name) values (${household.id}, 'B 카드') returning id
    `
    await raw`
      insert into transactions (household_id, date, flow, memo, amount, account_id, source)
      values
        (${household.id}, '2026-06-01', 'expense', 'Coffee ABC', 12000, ${accountA.id}, 'test'),
        (${household.id}, '2026-06-02', 'expense', '다른 내역', 34000, ${accountB.id}, 'test'),
        (${household.id}, '2026-06-03', 'expense', '카드 사용', 56000, ${accountA.id}, 'test'),
        (${otherHousehold.id}, '2026-06-04', 'expense', '섞이면 안 됨', 9999999, null, 'test')
    `
    await raw`
      update transactions
      set raw_merchant = 'Store XYZ'
      where household_id = ${household.id} and memo = '카드 사용'
    `

    const byQuery = await getLedgerData(household.id, '2026-06', {
      account: '', flow: '', major: '', q: 'coffee abc',
    })
    const byAccount = await getLedgerData(household.id, '2026-06', {
      account: String(accountA.id), flow: '', major: '', q: '',
    })
    const unsafeAccount = await getLedgerData(household.id, '2026-06', {
      account: '9007199254740992', flow: '', major: '', q: '',
    })
    const byMerchant = await getLedgerData(household.id, '2026-06', {
      account: '', flow: '', major: '', q: 'store xyz',
    })
    const shell = await getLedgerShellData(household.id, '2026-06', {
      account: '', flow: '', major: '', q: '',
    })

    expect(byQuery.transactions.map((row) => row.memo)).toEqual(['Coffee ABC'])
    expect(byAccount.transactions.map((row) => row.memo)).toEqual(['카드 사용', 'Coffee ABC'])
    expect(unsafeAccount.transactions).toEqual([])
    expect(byMerchant.transactions.map((row) => row.rawMerchant)).toEqual(['Store XYZ'])
    expect(shell.filteredTotals).toMatchObject({ count: 3, expense: 102000 })
    expect(shell.availableMonths).toContainEqual({ month: '2026-06', count: 3 })
  })
})
