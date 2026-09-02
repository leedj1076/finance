import { describe, expect, test } from 'vitest'

import {
  calculateExpenseForecast,
  calculateSafeToSpend,
} from '@/features/ledger/forecast'

describe('ledger expense forecast', () => {
  test('uses current-month run rate from the fifth elapsed day', () => {
    expect(calculateExpenseForecast({
      mtd: 500_000,
      historicalExpenseTotal: 1_200_000,
      historicalMonthCount: 2,
      elapsed: 5,
      daysInMonth: 30,
      isCurrentMonth: true,
    })).toEqual({
      mtd: 500_000,
      projected: 3_000_000,
      histAvg: 600_000,
      elapsed: 5,
      daysInMonth: 30,
      basis: 'run_rate',
      isCurrentMonth: true,
    })
  })

  test('uses the larger of MTD and completed-month average before day five', () => {
    expect(calculateExpenseForecast({
      mtd: 200_000,
      historicalExpenseTotal: 2_000_001,
      historicalMonthCount: 2,
      elapsed: 4,
      daysInMonth: 30,
      isCurrentMonth: true,
    })).toMatchObject({
      projected: 1_000_000,
      histAvg: 1_000_000,
      basis: 'hist_avg',
    })
  })

  test('falls back to MTD when there are no completed expense months', () => {
    expect(calculateExpenseForecast({
      mtd: 120_000,
      historicalExpenseTotal: 0,
      historicalMonthCount: 0,
      elapsed: 2,
      daysInMonth: 31,
      isCurrentMonth: true,
    })).toMatchObject({ projected: 120_000, histAvg: 0, basis: 'hist_avg' })
  })

  test('uses the completed amount rather than a run rate on the final day', () => {
    expect(calculateExpenseForecast({
      mtd: 900_000,
      historicalExpenseTotal: 1_000_000,
      historicalMonthCount: 2,
      elapsed: 30,
      daysInMonth: 30,
      isCurrentMonth: true,
    })).toMatchObject({ projected: 900_000, basis: 'hist_avg' })
  })
})

describe('ledger safe to spend', () => {
  test('uses the income ceiling for the savings target and inclusive days left', () => {
    expect(calculateSafeToSpend({
      averageIncome: 7_500_000,
      savingsTarget: 30,
      mtdExpense: 2_250_000,
      currentDay: 16,
      daysInMonth: 30,
      isCurrentMonth: true,
    })).toEqual({
      ceiling: 5_250_000,
      mtd: 2_250_000,
      remaining: 3_000_000,
      daily: 200_000,
      daysLeft: 15,
      rate: 30,
      hasIncome: true,
    })
  })

  test('reports no income without dividing by zero', () => {
    expect(calculateSafeToSpend({
      averageIncome: 0,
      savingsTarget: 30,
      mtdExpense: 100_000,
      currentDay: 10,
      daysInMonth: 30,
      isCurrentMonth: true,
    })).toMatchObject({
      ceiling: 0,
      remaining: -100_000,
      hasIncome: false,
    })
  })

  test('uses one day as the minimum divisor when no calendar days remain', () => {
    expect(calculateSafeToSpend({
      averageIncome: 1_000_000,
      savingsTarget: 30,
      mtdExpense: 800_000,
      currentDay: 31,
      daysInMonth: 30,
      isCurrentMonth: true,
    })).toMatchObject({ daysLeft: 1, daily: -100_000 })
  })

  test('does not calculate safe spending for another month', () => {
    expect(calculateSafeToSpend({
      averageIncome: 1_000_000,
      savingsTarget: 30,
      mtdExpense: 100_000,
      currentDay: 10,
      daysInMonth: 30,
      isCurrentMonth: false,
    })).toBeNull()
  })
})
