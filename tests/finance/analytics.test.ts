import { describe, expect, test } from 'vitest'

import {
  anomalyAlerts,
  categoryRanks,
  merchantRanks,
  monthlySummaries,
  type AnalyticsRow,
} from '@/features/analytics/calculations'

function row(
  id: number,
  date: string,
  amount: number,
  major = '식비',
  merchant = '스타벅스 강남1점',
  flow: AnalyticsRow['flow'] = 'expense',
): AnalyticsRow {
  return {
    id,
    date,
    flow,
    fixed: false,
    amount,
    major,
    sub: '기타',
    merchant,
    accountId: null,
    accountName: '',
  }
}

describe('analytics calculations', () => {
  test('uses net savings for monthly savings rate', () => {
    const summaries = monthlySummaries([
      row(1, '2026-06-01', 10_000_000, '월급', '급여', 'income'),
      row(2, '2026-06-02', 6_500_000),
      row(3, '2026-06-03', 2_000_000, '저축_투자', '적금', 'saving'),
    ], 2026)

    expect(summaries[5]).toMatchObject({
      income: 10_000_000,
      expense: 6_500_000,
      saving: 2_000_000,
      savingsRate: 35,
      active: true,
    })
  })

  test('ranks categories and compares the previous month', () => {
    const ranks = categoryRanks(
      [row(1, '2026-06-01', 300_000), row(2, '2026-06-02', 100_000, '교통비')],
      [row(3, '2026-05-01', 200_000), row(4, '2026-05-02', 150_000, '교통비')],
      'expense',
    )

    expect(ranks[0]).toMatchObject({ major: '식비', amount: 300_000, previous: 200_000, delta: 100_000 })
    expect(ranks[0].percent).toBe(75)
    expect(ranks[1].changeRate).toBeCloseTo(-33.333, 2)
  })

  test('merges merchant branch numbers for month-over-month comparison', () => {
    const ranks = merchantRanks(
      [row(1, '2026-06-01', 8_000), row(2, '2026-06-02', 7_000, '식비', '스타벅스 강남2점')],
      [row(3, '2026-05-01', 6_000, '식비', '스타벅스 강남3점')],
    )

    expect(ranks[0]).toMatchObject({ amount: 15_000, count: 2, previous: 6_000, delta: 9_000 })
  })

  test('flags statistical spikes and excludes irregular categories', () => {
    const history = [
      row(1, '2026-01-01', 90_000),
      row(2, '2026-02-01', 100_000),
      row(3, '2026-03-01', 110_000),
      row(4, '2026-04-01', 95_000),
      row(5, '2026-05-01', 105_000),
      row(6, '2026-06-01', 400_000),
      row(7, '2026-06-02', 800_000, '여행'),
    ]

    expect(anomalyAlerts(history, '2026-06', new Set(['여행']))).toMatchObject([
      { major: '식비', current: 400_000, typical: 100_000 },
    ])
  })
})
