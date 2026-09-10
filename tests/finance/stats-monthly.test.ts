import { describe, expect, test } from 'vitest'

import type { AccountMonthlyData } from '@/features/analytics/account-monthly'
import type { CategoryDetails } from '@/features/analytics/category-detail'
import {
  buildStatsMonthlyModel,
  parseStatsViewState,
  selectedStatsMonthlyRows,
  statsCellKey,
  statsSparkline,
  statsViewSearch,
  toggleStatsSeriesSelection,
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
  test('open months stay visible and provisional while averages use closed months only', () => {
    const closed: CategoryDetails = { ...details, expense: { ...details.expense,
      months: Array.from({ length: 12 }, (_, i) => i + 1), divisor: 2, provisionalDivisor: 3,
      closedMonths: [1, 3], endedMonths: [1, 2, 3], currentMonth: 4,
      states: ['closed', 'open', 'closed', 'current', 'future', 'future', 'future', 'future', 'future', 'future', 'future', 'future'],
    } }
    const model = buildStatsMonthlyModel({ flow: 'expense', axis: 'category', details: closed, accountMonthly, excluded: new Set() })
    expect(model.series[0].values.slice(0, 5)).toEqual([100, 100, 0, 0, null])
    expect(model.eligibleMonths.slice(0, 5)).toEqual([true, true, true, true, false])
    expect(model.closedMonths.slice(0, 4)).toEqual([true, false, true, false])
    expect(model.rows[0].total).toBe(200)
    expect(model.rows[0].closedTotal).toBe(100)
    expect(model.rows[0].average).toBe(50)
    expect(model.rows[0].provisionalTotal).toBe(200)
    expect(model.rows[0].provisionalAverage).toBe(67)
    expect(model.divisor).toBe(2)
  })

  test('a sparse trend uses real calendar positions and separate path segments instead of joining the gap', () => {
    const trend = statsSparkline([100, null, 200], 'expense', 3)
    expect(trend?.segments).toEqual(['2,17.0', '78,3.0'])
    expect(trend?.lastX).toBe(78)
    expect(statsSparkline([100, null, 200, null, null, null, null, null, null, null, null, null], 'expense', 12)?.segments).toEqual(['2,17.0', '78,3.0'])
    expect(statsSparkline([null, null, null], 'expense', 3)).toBeNull()
  })

  test('a six-point trend aligns its closed mask to calendar months after leading and trailing gaps', () => {
    const trend = statsSparkline(
      [null, null, 10, 20, 30, 40, 50, 60, 70, 80, null, null],
      'income',
      12,
      true,
      [false, false, true, true, true, true, false, true, true, true, false, false],
    )

    expect(trend?.segments).toEqual([
      '2,17.0 17.2,14.2',
      '17.2,14.2 32.4,11.4 47.599999999999994,8.6',
      '47.599999999999994,8.6 62.8,5.8 78,3.0',
    ])
    expect(trend?.provisionalSegments).toEqual([false, true, false])
    expect(trend?.lastProvisional).toBe(false)
  })

  test('provisional edges do not bridge gaps and retain recorded zero and refund points', () => {
    const trend = statsSparkline(
      [-100, 0, null, 50, 0],
      'expense',
      5,
      true,
      [true, false, false, true, false],
    )

    expect(trend?.segments).toEqual(['2,17.0 21,7.7', '59,3.0 78,7.7'])
    expect(trend?.provisionalSegments).toEqual([true, true])
    expect(trend?.points).toBe('2,17.0 21,7.7 59,3.0 78,7.7')
    expect(trend?.lastProvisional).toBe(true)
  })

  test('an omitted closed mask keeps the legacy sparkline solid', () => {
    const trend = statsSparkline([10, 20, 30], 'saving', 3, true)

    expect(trend?.segments).toEqual(['2,17.0 40,10.0 78,3.0'])
    expect(trend?.provisionalSegments).toEqual([false])
    expect(trend?.lastProvisional).toBe(false)
  })

  test('with nothing closed the official average is unavailable and the provisional one is offered', () => {
    const open: CategoryDetails = { ...details, expense: { ...details.expense,
      months: Array.from({ length: 12 }, (_, i) => i + 1), divisor: 0, provisionalDivisor: 2,
      closedMonths: [], endedMonths: [1, 2], currentMonth: 3,
      states: ['open', 'open', 'current', 'future', 'future', 'future', 'future', 'future', 'future', 'future', 'future', 'future'],
    } }
    const model = buildStatsMonthlyModel({ flow: 'expense', axis: 'category', details: open, accountMonthly, excluded: new Set() })
    expect(model.average).toBeNull()
    expect(model.provisionalAverage).toBe(185)
    expect(model.provisionalTotal).toBe(370)
    expect(model.series.length).toBe(4)
  })

  test('recording state keeps absent open and current values null while a closed zero stays visible', () => {
    const masked: CategoryDetails = { ...details, expense: { ...details.expense,
      groups: details.expense.groups.map(group => ({
        ...group,
        subs: group.subs.map(sub => ({ ...sub, months: sub.months.map((value, index) => index === 1 ? 0 : value) })),
      })),
      months: Array.from({ length: 12 }, (_, i) => i + 1), divisor: 2, provisionalDivisor: 2,
      currentMonth: 4, closedMonths: [1, 2], endedMonths: [1, 2, 3],
      recordedMonths: [1], provisionalMonths: [1, 2],
      states: ['closed', 'closed', 'open', 'current', 'future', 'future', 'future', 'future', 'future', 'future', 'future', 'future'],
    } }

    const category = buildStatsMonthlyModel({ flow: 'expense', axis: 'category', details: masked, accountMonthly, excluded: new Set() })
    expect(category.eligibleMonths.slice(0, 5)).toEqual([true, true, true, true, false])
    expect(category.availableMonths).toEqual([true, true, false, false, false, false, false, false, false, false, false, false])
    expect(category.series[0].values.slice(0, 5)).toEqual([100, 0, null, null, null])
    expect(category.rows[0].displayValues.slice(0, 5)).toEqual([100, 0, null, null, null])
    expect(category.rows[0].subs[0]).toMatchObject({
      total: 40, closedTotal: 40, provisionalTotal: 40, average: 20, provisionalAverage: 20,
    })
    const [selected] = selectedStatsMonthlyRows(category.rows, 'category\u0000식비')
    const selectedTrendValues = selected.values.map((value, month) => category.availableMonths[month] ? value : null)
    const subTrendValues = selected.subs[0].values.map((value, month) => category.availableMonths[month] ? value : null)
    expect(selectedTrendValues.slice(0, 5)).toEqual([100, 0, null, null, null])
    expect(subTrendValues.slice(0, 5)).toEqual([40, 0, null, null, null])
    expect(statsSparkline(selectedTrendValues, 'expense', category.activeMonths, true)?.points.split(' ')).toHaveLength(2)
    expect(statsSparkline(subTrendValues, 'expense', category.activeMonths, true)?.points.split(' ')).toHaveLength(2)

    const maskedAccountMonthly = {
      ...accountMonthly,
      expense: {
        ...accountMonthly.expense,
        series: Object.fromEntries(Object.entries(accountMonthly.expense.series).map(([name, values]) => (
          [name, values.map((value, index) => index === 1 ? null : value)]
        ))),
      },
    }
    const account = buildStatsMonthlyModel({ flow: 'expense', axis: 'account', details: masked, accountMonthly: maskedAccountMonthly, excluded: new Set() })
    expect(account.availableMonths).toEqual([true, true, false, false, false, false, false, false, false, false, false, false])
    expect(account.series[0].values.slice(0, 5)).toEqual([90, 0, null, null, null])
    expect(account.rows[0].displayValues.slice(0, 5)).toEqual([90, 0, null, null, null])
  })

  test('closed zero and refund months retain their calendar slots in mini-trends', () => {
    expect(statsSparkline([0, null, 200], 'expense', 3, true)?.segments).toEqual(['2,17.0', '78,3.0'])
    expect(statsSparkline([0, null, 200, 300], 'expense', 4, true)?.segments).toEqual(['2,17.0', '52.666666666666664,7.7 78,3.0'])
    expect(statsSparkline([0, null, 0], 'expense', 3, true)?.segments).toHaveLength(2)
    expect(statsSparkline([-100, null, 200], 'expense', 3, true)?.segments).toEqual(['2,17.0', '78,3.0'])
    expect(statsSparkline([null, null, 200], 'expense', 3, true)).toBeNull()
    // Existing live callers keep their first-positive-month convention.
    expect(statsSparkline([0, null, 200], 'expense', 3)).toBeNull()
  })
  test('shows all rows by default and only the selected series row after selection', () => {
    const model = buildStatsMonthlyModel({
      flow: 'expense', axis: 'category', details, accountMonthly, excluded: new Set(),
    })
    const selected = selectedStatsMonthlyRows(model.rows, 'category\u0000식비')

    expect(selected.map((row) => row.label)).toEqual(['식비'])
    expect(selected[0].subs.map((row) => row.label)).toEqual(['외식', '장보기'])
    expect(selectedStatsMonthlyRows(model.rows, null).map((row) => row.label)).toEqual(['식비', '생활', '의료', '교통'])
    expect(selectedStatsMonthlyRows(model.rows, 'category\u0000없는 항목')).toEqual([])
  })

  test('selects a chart point, updates its month, and clears the same point', () => {
    expect(toggleStatsSeriesSelection(null, { seriesId: 'category\u0000식비', month: 0 })).toEqual({
      seriesId: 'category\u0000식비', month: 0,
    })
    expect(toggleStatsSeriesSelection(
      { seriesId: 'category\u0000식비', month: 0 },
      { seriesId: 'category\u0000식비', month: 1 },
    )).toEqual({ seriesId: 'category\u0000식비', month: 1 })
    expect(toggleStatsSeriesSelection(
      { seriesId: 'category\u0000식비', month: 1 },
      { seriesId: 'category\u0000식비', month: 1 },
    )).toBeNull()
  })

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
    expect(model.rows.map((row) => row.values.slice(0, 2))).toEqual(model.series.map((item) => item.values.slice(0, 2)))
    expect(model.series.every((item) => item.values.slice(2).every(value => value === null))).toBe(true)
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
    expect(model.closedTotal).toBe(330)
    expect(model.provisionalTotal).toBe(330)
    expect(model.average).toBe(165)
    expect(model.provisionalAverage).toBe(165)
    expect(model.rows[0]).toMatchObject({
      total: 160, closedTotal: 160, provisionalTotal: 160, average: 80, provisionalAverage: 80,
    })
    expect(model.rows[0].subs[0]).toMatchObject({
      total: 60, closedTotal: 60, provisionalTotal: 60, average: 30, provisionalAverage: 30,
    })
  })

  test('account exclusions reduce displayed, closed, and provisional bases together', () => {
    const modern: CategoryDetails = { ...details, expense: { ...details.expense,
      months: Array.from({ length: 12 }, (_, i) => i + 1), divisor: 1, provisionalDivisor: 2,
      currentMonth: 3, closedMonths: [1], endedMonths: [1, 2], recordedMonths: [1, 2], provisionalMonths: [1, 2],
      states: ['closed', 'open', 'current', 'future', 'future', 'future', 'future', 'future', 'future', 'future', 'future', 'future'],
    } }
    const excluded = new Set([statsCellKey({ axis: 'account', label: 'DJ 카드', month: 0 })])
    const model = buildStatsMonthlyModel({ flow: 'expense', axis: 'account', details: modern, accountMonthly, excluded })

    expect(model.rows[0]).toMatchObject({
      total: 80, closedTotal: 0, provisionalTotal: 80, average: 0, provisionalAverage: 40,
    })
    expect(model).toMatchObject({
      total: 280, closedTotal: 80, provisionalTotal: 280, average: 80, provisionalAverage: 140,
    })
  })

  test('legacy inputs still exclude the current month from official and provisional averages', () => {
    const legacy: CategoryDetails = { ...details, expense: { ...details.expense, currentMonth: 2, divisor: 1 } }
    const model = buildStatsMonthlyModel({ flow: 'expense', axis: 'category', details: legacy, accountMonthly, excluded: new Set() })

    expect(model.total).toBe(370)
    expect(model.closedTotal).toBe(170)
    expect(model.provisionalTotal).toBe(170)
    expect(model.average).toBe(170)
    expect(model.provisionalAverage).toBe(170)
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
