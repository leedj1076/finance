import { describe, expect, test } from 'vitest'

import type { AccountMonthlyData, CategoryMonthlyData } from '@/features/analytics/account-monthly'
import type { CategoryDetails } from '@/features/analytics/category-detail'
import { CHART_OTHER } from '@/features/analytics/chart-theme'
import {
  buildStatsMonthlyModel,
  statsCellKey,
} from '@/features/analytics/stats-monthly'

const details: CategoryDetails = {
  expense: {
    groups: [
      { major: '식비', subs: [
        { sub: '외식', months: [40, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { sub: '장보기', months: [60, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      ] },
      { major: '생활', subs: [
        { sub: '쇼핑', months: [50, 70, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      ] },
    ],
    months: [1, 2],
    divisor: 2,
    currentMonth: null,
  },
  income: { groups: [], months: [], divisor: 1, currentMonth: null },
  saving: { groups: [], months: [], divisor: 1, currentMonth: null },
}

const categoryMonthly: Record<'expense' | 'income' | 'saving', CategoryMonthlyData> = {
  expense: {
    categories: ['식비', '생활', '그 외'],
    series: {
      식비: [100, 100, null, null, null, null, null, null, null, null, null, null],
      생활: [50, 70, null, null, null, null, null, null, null, null, null, null],
      '그 외': [20, 30, null, null, null, null, null, null, null, null, null, null],
    },
    folded: ['교통', '의료'],
  },
  income: { categories: [], series: {} },
  saving: { categories: [], series: {} },
}

const accountMonthly: Record<'expense' | 'income', AccountMonthlyData> = {
  expense: {
    accounts: ['DJ 카드', 'YJ 카드'],
    series: {
      'DJ 카드': [90, 80, null, null, null, null, null, null, null, null, null, null],
      'YJ 카드': [80, 120, null, null, null, null, null, null, null, null, null, null],
    },
  },
  income: { accounts: [], series: {} },
}

describe('stats monthly shared model', () => {
  test('uses the same values, order, and colors for category rows and chart series', () => {
    const model = buildStatsMonthlyModel({
      flow: 'expense', axis: 'category', details, categoryMonthly, accountMonthly, excluded: new Set(),
    })

    expect(model.series.map((item) => item.label)).toEqual(['식비', '생활', '그 외 2개 대분류'])
    expect(model.rows.map((row) => row.values)).toEqual(model.series.map((item) => item.values))
    expect(model.rows[0].subs.map((row) => row.label)).toEqual(['외식', '장보기'])
    expect(model.rows[2].color).toBe(CHART_OTHER)
    expect(model.monthTotals.slice(0, 2)).toEqual([170, 200])
  })

  test('removes an excluded subcategory cell from its parent series, total, and average', () => {
    const excluded = new Set([
      statsCellKey({ axis: 'category', label: '식비', sub: '외식', month: 0 }),
    ])
    const model = buildStatsMonthlyModel({
      flow: 'expense', axis: 'category', details, categoryMonthly, accountMonthly, excluded,
    })

    expect(model.rows[0].values.slice(0, 2)).toEqual([60, 100])
    expect(model.series[0].values.slice(0, 2)).toEqual([60, 100])
    expect(model.monthTotals.slice(0, 2)).toEqual([130, 200])
    expect(model.total).toBe(330)
    expect(model.average).toBe(165)
  })

  test('switches the shared chart and rows to the payment-method axis', () => {
    const model = buildStatsMonthlyModel({
      flow: 'expense', axis: 'account', details, categoryMonthly, accountMonthly, excluded: new Set(),
    })

    expect(model.rows.map((row) => row.label)).toEqual(['DJ 카드', 'YJ 카드'])
    expect(model.series.map((item) => item.values.slice(0, 2))).toEqual([[90, 80], [80, 120]])
    expect(model.rows.every((row) => row.subs.length === 0)).toBe(true)
  })
})
