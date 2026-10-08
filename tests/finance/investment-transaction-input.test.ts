import { describe, expect, it } from 'vitest'

import { parseManualTransaction } from '@/features/investment/transaction-input'

const ctx = {
  accountIds: [1, 2],
  securities: [
    { id: 10, market: 'KR' as const, currency: 'KRW' as const },
    { id: 20, market: 'US' as const, currency: 'USD' as const },
  ],
  today: '2026-09-29',
}
function form(entries: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

describe('parseManualTransaction', () => {
  it('computes the signed amount for a buy including fee', () => {
    const result = parseManualTransaction(form({ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '10', price: '70000', fee: '150' }), ctx)
    expect(result).toEqual({ data: { accountId: 1, securityId: 10, kind: 'buy', tradeDate: '2026-09-01', quantity: 10, price: 70000, fee: 150, amount: -700150, currency: 'KRW', memo: null } })
  })
  it('computes sell, dividend, deposit, withdraw and adjust amounts', () => {
    const sell = parseManualTransaction(form({ accountId: '1', securityId: '10', kind: 'sell', tradeDate: '2026-09-01', quantity: '10', price: '80700', fee: '500' }), ctx)
    expect('data' in sell && sell.data.amount).toBe(806500)
    const dividend = parseManualTransaction(form({ accountId: '2', securityId: '20', kind: 'dividend', tradeDate: '2026-09-01', amount: '6.63' }), ctx)
    expect('data' in dividend && dividend.data).toMatchObject({ amount: 6.63, currency: 'USD', quantity: null, price: null })
    const deposit = parseManualTransaction(form({ accountId: '1', kind: 'deposit', tradeDate: '2026-09-01', amount: '3000000', currency: 'KRW' }), ctx)
    expect('data' in deposit && deposit.data).toMatchObject({ securityId: null, amount: 3000000 })
    const withdraw = parseManualTransaction(form({ accountId: '1', kind: 'withdraw', tradeDate: '2026-09-01', amount: '500', currency: 'USD' }), ctx)
    expect('data' in withdraw && withdraw.data).toMatchObject({ amount: -500, currency: 'USD' })
    const adjust = parseManualTransaction(form({ accountId: '1', securityId: '10', kind: 'adjust', tradeDate: '2026-09-01', quantity: '-2', price: '73640' }), ctx)
    expect('data' in adjust && adjust.data).toMatchObject({ quantity: -2, price: 73640, amount: 0 })
  })
  it('rejects the inputs a careless form will send', () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ accountId: '9', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '1' }, /계좌/],
      [{ accountId: '1', securityId: '99', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '1' }, /종목/],
      [{ accountId: '1', securityId: '10', kind: 'gift', tradeDate: '2026-09-01' }, /종류/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2027-01-01', quantity: '1', price: '1' }, /날짜/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '1989-12-31', quantity: '1', price: '1' }, /날짜/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '-1', price: '1' }, /수량/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '1.1234567', price: '1' }, /소수/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '-1' }, /단가/],
      [{ accountId: '1', kind: 'deposit', tradeDate: '2026-09-01', amount: '0', currency: 'KRW' }, /금액/],
      [{ accountId: '1', kind: 'deposit', tradeDate: '2026-09-01', amount: '100', currency: 'EUR' }, /통화/],
      [{ accountId: '1', securityId: '20', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '1', currency: 'KRW' }, /통화/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '1', currency: 'USD' }, /통화/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '1', memo: 'x'.repeat(201) }, /메모/],
    ]
    for (const [entries, pattern] of cases) {
      const result = parseManualTransaction(form(entries), ctx)
      expect('error' in result ? result.error : 'no error').toMatch(pattern)
    }
  })
})

it.each<Record<string, string>>([
  { tradeDate: '2026-02-30' }, { tradeDate: '2026-13-01' },
  { quantity: '1e-7' }, { quantity: '0.0000001' }, { quantity: '999999999999999999' },
  { price: 'NaN' }, { price: 'Infinity' }, { price: '1.12345' },
  { fee: '-1' }, { fee: '0.001' }, { quantity: '1000000', price: '100000000' },
  { quantity: '1,2' }, { accountId: '1.1' },
])('rejects invalid or unsafe financial input %j', (patch) => {
  const result = parseManualTransaction(form({ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '1', ...patch }), ctx)
  expect(result).toHaveProperty('error')
})

it('rejects sub-cent cash and accepts valid fee transactions and leap dates', () => {
  expect(parseManualTransaction(form({ accountId: '1', kind: 'deposit', tradeDate: '2026-09-01', amount: '0.001', currency: 'USD' }), ctx)).toHaveProperty('error')
  expect(parseManualTransaction(form({ accountId: '1', kind: 'fee', tradeDate: '2024-02-29', amount: '1.25', currency: 'USD' }), ctx)).toMatchObject({ data: { amount: -1.25 } })
})

it('ignores stale security selection for a cash transaction', () => {
  expect(parseManualTransaction(form({ accountId: '1', securityId: '10', kind: 'deposit', tradeDate: '2026-09-01', amount: '10', currency: 'USD' }), ctx)).toMatchObject({ data: { securityId: null, currency: 'USD', amount: 10 } })
})
