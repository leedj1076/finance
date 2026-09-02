import { describe, expect, test } from 'vitest'

import { detectRecurringCandidates, recurringPostingDate } from '@/features/recurring/calculations'
import { flowToToken, parseRecurringPayload, tokenToFlow } from '@/features/recurring/recurring-input'

describe('recurring calculations', () => {
  test('detects a monthly merchant and excludes high-frequency or known merchants', () => {
    const rows = [
      { date: '2026-01-10', amount: 10_000, merchant: '넷플릭스 01' },
      { date: '2026-02-10', amount: 11_000, merchant: '넷플릭스 02' },
      { date: '2026-03-10', amount: 12_000, merchant: '넷플릭스 03' },
      { date: '2026-01-01', amount: 5_000, merchant: '매일카페 1호점' },
      { date: '2026-01-02', amount: 5_000, merchant: '매일카페 1호점' },
      { date: '2026-01-03', amount: 5_000, merchant: '매일카페 1호점' },
      { date: '2026-02-01', amount: 5_000, merchant: '매일카페 2호점' },
      { date: '2026-02-02', amount: 5_000, merchant: '매일카페 2호점' },
      { date: '2026-03-01', amount: 5_000, merchant: '매일카페 3호점' },
    ]

    expect(detectRecurringCandidates(rows)).toEqual([
      { name: '넷플릭스 03', average: 11_000, months: 3, lastDate: '2026-03-10', suggestedDay: 10 },
    ])
    expect(detectRecurringCandidates(rows, ['넷플릭스'])).toEqual([])
  })

  test('clamps a recurring day to the final day of the month', () => {
    expect(recurringPostingDate('2026-02', 31)).toBe('2026-02-28')
    expect(recurringPostingDate('2028-02', 31)).toBe('2028-02-29')
    expect(recurringPostingDate('2026-04', 15)).toBe('2026-04-15')
  })
})

describe('recurring input', () => {
  test('maps display tokens to transaction fields', () => {
    expect(tokenToFlow('exp_fix')).toEqual({ flow: 'expense', fixed: true })
    expect(tokenToFlow('saving')).toEqual({ flow: 'saving', fixed: false })
    expect(flowToToken('expense', false)).toBe('exp_var')
  })

  test('parses existing and new recurring rules', () => {
    const form = new FormData()
    form.set('rules', JSON.stringify([
      { id: 1, flowToken: 'exp_fix', categoryId: 2, memo: '통신비', amount: '45,000', accountId: 3, day: 26, active: true },
      { id: null, flowToken: 'income', categoryId: null, memo: '급여', amount: '5000000', accountId: null, day: 31, active: false },
      { id: null, flowToken: 'exp_fix', categoryId: null, memo: '', amount: '', accountId: null, day: 1, active: true },
    ]))

    expect(parseRecurringPayload(form.get('rules'))).toEqual({ data: [
      { id: 1, flow: 'expense', fixed: true, categoryId: 2, memo: '통신비', amount: 45_000, accountId: 3, day: 26, active: true },
      { id: null, flow: 'income', fixed: false, categoryId: null, memo: '급여', amount: 5_000_000, accountId: null, day: 31, active: false },
    ] })
  })

  test('rejects invalid amount and day values', () => {
    expect(parseRecurringPayload(JSON.stringify([
      { id: 1, flowToken: 'exp_fix', memo: '통신비', amount: 0, day: 32, active: true },
    ]))).toEqual({ error: '통신비 금액은 0보다 큰 정수로 입력해 주세요.' })
  })
})
