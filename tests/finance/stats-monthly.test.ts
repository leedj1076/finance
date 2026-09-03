import { describe, expect, test } from 'vitest'

import type { AccountMonthlyData } from '@/features/analytics/account-monthly'
import type { CategoryDetails } from '@/features/analytics/category-detail'
import {
  buildStatsMonthlyModel,
  parseStatsViewState,
  statsCellKey,
  statsSparkline,
  statsViewSearch,
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
      { major: '교통', subs: [
        { sub: '대중교통', months: [20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      ] },
      { major: '의료', subs: [
        { sub: '병원', months: [0, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      ] },
    ],
    months: [1, 2],
    divisor: 2,
    currentMonth: null,
  },
  income: { groups: [], months: [], divisor: 1, currentMonth: null },
  saving: { groups: [], months: [], divisor: 1, currentMonth: null },
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
  test('parses shareable view state and locks non-expense flows to category', () => {
    expect(parseStatsViewState({ chart: 'line', flow: 'expense', axis: 'account' })).toEqual({
      chart: 'line', flow: 'expense', axis: 'account',
    })
    expect(parseStatsViewState({ chart: 'area', flow: 'income', axis: 'account' })).toEqual({
      chart: 'area', flow: 'income', axis: 'category',
    })
    expect(parseStatsViewState({ chart: 'pie', flow: 'other', axis: 'merchant' })).toEqual({
      chart: 'stacked', flow: 'expense', axis: 'category',
    })
  })

  test('writes view state while preserving year and drill-down params', () => {
    expect(statsViewSearch('?year=2025&major=%EC%8B%9D%EB%B9%84', {
      chart: 'area', flow: 'saving', axis: 'account',
    })).toBe('year=2025&major=%EC%8B%9D%EB%B9%84&chart=area&flow=saving&axis=category')
  })

  test('expands folded category data into every major for rows and chart series', () => {
    const model = buildStatsMonthlyModel({
      flow: 'expense', axis: 'category', details, accountMonthly, excluded: new Set(),
    })

    expect(model.series.map((item) => item.label)).toEqual(['식비', '생활', '의료', '교통'])
    expect(model.rows.map((row) => row.values)).toEqual(model.series.map((item) => item.values))
    expect(model.rows[0].subs.map((row) => row.label)).toEqual(['외식', '장보기'])
    expect(model.rows.some((row) => row.label.startsWith('그 외'))).toBe(false)
    expect(model.monthTotals.slice(0, 2)).toEqual([170, 200])
    expect(model.activeMonths).toBe(2)
  })

  test('removes an excluded subcategory cell from its parent series, total, and average', () => {
    const excluded = new Set([
      statsCellKey({ axis: 'category', label: '식비', sub: '외식', month: 0 }),
    ])
    const model = buildStatsMonthlyModel({
      flow: 'expense', axis: 'category', details, accountMonthly, excluded,
    })

    expect(model.rows[0].values.slice(0, 2)).toEqual([60, 100])
    expect(model.series[0].values.slice(0, 2)).toEqual([60, 100])
    expect(model.monthTotals.slice(0, 2)).toEqual([130, 200])
    expect(model.total).toBe(330)
    expect(model.average).toBe(165)
  })

  test('switches the shared chart and rows to the payment-method axis', () => {
    const model = buildStatsMonthlyModel({
      flow: 'expense', axis: 'account', details, accountMonthly, excluded: new Set(),
    })

    expect(model.rows.map((row) => row.label)).toEqual(['DJ 카드', 'YJ 카드'])
    expect(model.series.map((item) => item.values.slice(0, 2))).toEqual([[90, 80], [80, 120]])
    expect(model.rows.every((row) => row.subs.length === 0)).toBe(true)
  })

  test('builds trends from recorded months instead of trailing future zeros', () => {
    const trend = statsSparkline([100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'expense', 3)

    expect(trend?.points.split(' ')).toHaveLength(3)
    expect(trend?.lastY).toBe(3)
  })
})
