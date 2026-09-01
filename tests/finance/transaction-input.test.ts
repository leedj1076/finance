import { describe, expect, test } from 'vitest'

import { parseTransactionInput } from '@/features/ledger/transaction-input'

function form(values: Record<string, string>) {
  const data = new FormData()
  Object.entries(values).forEach(([key, value]) => data.set(key, value))
  return data
}

describe('transaction input parsing', () => {
  test('parses comma-formatted won amounts and optional references', () => {
    const result = parseTransactionInput(
      form({
        date: '2026-05-12',
        flow: 'expense',
        fixed: 'on',
        categoryId: '3',
        accountId: '2',
        amount: '12,500원',
        memo: '장보기',
        transactionId: '',
      }),
    )

    expect(result.data).toEqual({
      id: null,
      date: '2026-05-12',
      flow: 'expense',
      fixed: true,
      categoryId: 3,
      accountId: 2,
      amount: 12_500,
      memo: '장보기',
      month: '2026-05',
    })
  })

  test('allows negative refund amounts', () => {
    const result = parseTransactionInput(
      form({ date: '2026-05-12', flow: 'expense', amount: '-5000' }),
    )
    expect(result.data?.amount).toBe(-5_000)
  })

  test('rejects impossible dates and zero amounts', () => {
    expect(
      parseTransactionInput(form({ date: '2026-02-30', flow: 'expense', amount: '1000' })).error,
    ).toContain('날짜')
    expect(
      parseTransactionInput(form({ date: '2026-02-28', flow: 'expense', amount: '0' })).error,
    ).toContain('금액')
  })

  test('never marks income as a fixed expense', () => {
    const result = parseTransactionInput(
      form({ date: '2026-05-12', flow: 'income', fixed: 'on', amount: '1000' }),
    )
    expect(result.data?.fixed).toBe(false)
  })
})
