import postgres from 'postgres'
import { afterAll, describe, expect, test } from 'vitest'

import {
  buildAnnualReport,
  getReportData,
  type ReportAssetBalanceRow,
  type ReportTransactionRow,
} from '@/features/analytics/report'

function transaction(
  id: number,
  date: string,
  flow: ReportTransactionRow['flow'],
  amount: number,
  major = '미분류',
  memo: string | null = null,
): ReportTransactionRow {
  return { id, date, flow, amount, major, memo }
}

describe('annual report calculations', () => {
  const transactions: ReportTransactionRow[] = [
    transaction(1, '2025-01-10', 'income', 8_000_000, '급여'),
    transaction(2, '2025-01-11', 'expense', 5_000_000, '주거'),
    transaction(3, '2025-01-12', 'saving', 1_000_000, '저축'),
    transaction(4, '2026-01-10', 'income', 10_000_000, '급여'),
    transaction(5, '2026-01-11', 'expense', 6_000_000, '주거', '주택 비용'),
    transaction(6, '2026-01-12', 'saving', 2_000_000, '저축'),
    transaction(7, '2026-02-10', 'income', 10_000_000, '급여'),
    transaction(8, '2026-02-11', 'expense', 3_000_000, '식비', '장보기'),
    transaction(9, '2026-02-12', 'expense', 2_000_000, '교통'),
    transaction(10, '2026-09-01', 'income', 10_000_000, '급여'),
    transaction(11, '2026-09-02', 'expense', 4_000_000, '여행', '가족 여행'),
    transaction(12, '2026-09-02', 'expense', 1_500_000, '교육'),
    transaction(13, '2026-09-02', 'expense', 1_200_000, '의료'),
    transaction(14, '2026-09-02', 'expense', 900_000, '문화'),
    transaction(15, '2026-09-02', 'expense', 800_000, '기타'),
    transaction(16, '2026-09-02', 'expense', 600_000, '용돈'),
  ]
  const balances: ReportAssetBalanceRow[] = [
    { accountId: 1, kind: 'asset', major: '현금', month: '2026-01', amount: 1_000_000 },
    { accountId: 1, kind: 'asset', major: '현금', month: '2026-08', amount: 1_500_000 },
    { accountId: 2, kind: 'asset', major: '저축·투자', month: '2026-07', amount: 2_000_000 },
    { accountId: 3, kind: 'asset', major: '부동산', month: '2026-08', amount: 500_000_000 },
    { accountId: 4, kind: 'liability', major: '대출', month: '2026-08', amount: 100_000_000 },
  ]

  test('calculates annual KPIs, YoY, rates, top six, and the largest expense', () => {
    const report = buildAnnualReport({
      year: 2026,
      currentMonthKey: '2026-09',
      transactions,
      assetBalances: balances,
    })

    expect(report.annual).toEqual({
      income: 30_000_000,
      expense: 20_000_000,
      saving: 2_000_000,
      netSaving: 10_000_000,
      savingsRate: 33.3,
    })
    expect(report.previous).toEqual({
      income: 8_000_000,
      expense: 5_000_000,
      saving: 1_000_000,
      netSaving: 3_000_000,
      savingsRate: 37.5,
    })
    expect(report.yoy).toMatchObject({
      income: { delta: 22_000_000, pct: 275, previous: 8_000_000 },
      expense: { delta: 15_000_000, pct: 300, previous: 5_000_000 },
      netSaving: { delta: 7_000_000, pct: 233, previous: 3_000_000 },
      saving: { delta: 1_000_000, pct: 100, previous: 1_000_000 },
    })
    expect(report.topExpenses).toHaveLength(6)
    expect(report.topExpenses.map((row) => row.major)).toEqual([
      '주거', '여행', '식비', '교통', '교육', '의료',
    ])
    expect(report.topExpenses[0]).toEqual({ major: '주거', amount: 6_000_000, percent: 30 })
    expect(report.largestExpense).toMatchObject({ amount: 6_000_000, memo: '주택 비용', date: '2026-01-11', major: '주거' })
    expect(report.bestMonth).toEqual({ month: 2, savingsRate: 50 })
    expect(report.worstMonth).toEqual({ month: 9, savingsRate: 10 })
  })

  test('excludes the current month from both cashflow numerator and divisor', () => {
    const report = buildAnnualReport({
      year: 2026,
      currentMonthKey: '2026-09',
      transactions,
      assetBalances: balances,
    })

    expect(report.cashflow).toMatchObject({
      startCash: 3_500_000,
      completedMonthDivisor: 2,
      monthlyNet: 4_500_000,
    })
    expect(report.cashflow.forecast).toEqual([
      { month: '2026-10', net: 4_500_000, balance: 8_000_000 },
      { month: '2026-11', net: 4_500_000, balance: 12_500_000 },
      { month: '2026-12', net: 4_500_000, balance: 17_000_000 },
      { month: '2027-01', net: 4_500_000, balance: 21_500_000 },
      { month: '2027-02', net: 4_500_000, balance: 26_000_000 },
      { month: '2027-03', net: 4_500_000, balance: 30_500_000 },
    ])
  })

  test('uses every active month for a past year and handles empty reports', () => {
    const past = buildAnnualReport({
      year: 2025,
      currentMonthKey: '2026-09',
      transactions,
      assetBalances: [],
    })
    const empty = buildAnnualReport({
      year: 2024,
      currentMonthKey: '2026-09',
      transactions: [],
      assetBalances: [],
    })

    expect(past.cashflow).toMatchObject({ completedMonthDivisor: 1, monthlyNet: 3_000_000 })
    expect(empty).toMatchObject({
      hasPrevious: false,
      annual: { income: 0, expense: 0, saving: 0, netSaving: 0, savingsRate: 0 },
      topExpenses: [],
      largestExpense: null,
      bestMonth: null,
      worstMonth: null,
      cashflow: { startCash: 0, completedMonthDivisor: 1, monthlyNet: 0 },
    })
    expect(empty.yoy.income.pct).toBeNull()
  })
})

describe('annual report household scope', () => {
  const raw = postgres(process.env.DATABASE_URL!, { prepare: false })
  const householdIds: string[] = []

  afterAll(async () => {
    if (householdIds.length > 0) await raw`delete from households where id in ${raw(householdIds)}`
    await raw.end()
  })

  test('does not mix another household transactions or cash balances', async () => {
    const suffix = Date.now()
    const [householdA] = await raw`insert into households (name) values (${`report-a-${suffix}`}) returning id`
    const [householdB] = await raw`insert into households (name) values (${`report-b-${suffix}`}) returning id`
    householdIds.push(householdA.id, householdB.id)

    const [categoryA] = await raw`
      insert into categories (household_id, kind, major, sub)
      values (${householdA.id}, 'expense', '식비', '외식') returning id
    `
    const [categoryB] = await raw`
      insert into categories (household_id, kind, major, sub)
      values (${householdB.id}, 'expense', '식비', '외식') returning id
    `
    await raw`
      insert into transactions (household_id, date, flow, amount, category_id, memo)
      values
        (${householdA.id}, '2026-01-01', 'income', 1000000, null, 'A 수입'),
        (${householdA.id}, '2026-01-02', 'expense', 400000, ${categoryA.id}, 'A 지출'),
        (${householdB.id}, '2026-01-01', 'income', 9000000, null, 'B 수입'),
        (${householdB.id}, '2026-01-02', 'expense', 8000000, ${categoryB.id}, 'B 지출')
    `
    const [assetA] = await raw`
      insert into asset_accounts (household_id, major, name, kind)
      values (${householdA.id}, '현금', 'A 현금', 'asset') returning id
    `
    const [assetB] = await raw`
      insert into asset_accounts (household_id, major, name, kind)
      values (${householdB.id}, '현금', 'B 현금', 'asset') returning id
    `
    await raw`
      insert into balance_snapshots (household_id, account_id, month, amount)
      values
        (${householdA.id}, ${assetA.id}, '2026-01', 2000000),
        (${householdB.id}, ${assetB.id}, '2026-01', 99000000)
    `

    const report = await getReportData(householdA.id, 2026)

    expect(report.annual).toMatchObject({ income: 1_000_000, expense: 400_000 })
    expect(report.cashflow.startCash).toBe(2_000_000)
    expect(report.largestExpense?.memo).toBe('A 지출')
  })
})
